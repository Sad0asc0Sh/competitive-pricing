'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { createServer } = require('node:net')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { loadTsModule } = require('./helpers/ts-loader.cjs')

const relayCrypto = loadTsModule('src/lib/torob-relay/crypto.ts')
const relayConfig = loadTsModule('src/lib/torob-relay/config.ts')

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

async function waitForPort(port, host = '127.0.0.1', timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const sock = require('node:net').connect({ port, host })
        sock.once('connect', () => { sock.end(); resolve() })
        sock.once('error', reject)
      })
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 80))
    }
  }
  return false
}

test('R1. normalizeRelayUrl: آدرس خام با کلید پذیرفته می‌شود و HTTP بدون کلید رد می‌شود', () => {
  const ok = relayCrypto.normalizeRelayUrl('2.180.37.182:43389', true)
  assert.equal(ok.url, 'http://2.180.37.182:43389')
  assert.equal(ok.error, undefined)

  const noKeyHttp = relayCrypto.normalizeRelayUrl('http://2.180.37.182:43389', false)
  assert.ok(noKeyHttp.error, 'HTTP بدون کلید نباید مجاز باشد')

  const noKeyBare = relayCrypto.normalizeRelayUrl('2.180.37.182:43389', false)
  assert.ok(noKeyBare.error, 'آدرس بدون https و بدون کلید نباید مجاز باشد')

  const httpsPlain = relayCrypto.normalizeRelayUrl('https://relay.example.com/', false)
  assert.equal(httpsPlain.url, 'https://relay.example.com')
  assert.equal(httpsPlain.error, undefined)
})

test('R2. resolveTorobRelayConfig: اولویت پنل دیتابیس بر .env و پشتیبانی از خاموش‌کردن', () => {
  const fromEnv = relayConfig.resolveTorobRelayConfig(null, {
    apiBase: '2.180.37.182:43389',
    relayKey: 'EnvSecretKey1',
  })
  assert.equal(fromEnv.source, 'env')
  assert.equal(fromEnv.mode, 'encrypted_relay')
  assert.equal(fromEnv.url, 'http://2.180.37.182:43389')

  const fromDbDisabled = relayConfig.resolveTorobRelayConfig(
    { enabled: false, url: '2.180.37.182:43389', relayKey: 'DbSecretKey1' },
    { apiBase: 'https://env-fallback.example', relayKey: '' },
  )
  assert.equal(fromDbDisabled.source, 'db')
  assert.equal(fromDbDisabled.configured, false)
  assert.equal(fromDbDisabled.mode, 'direct')
})

test('R3. رمزنگاری AES-256-GCM: کلید اشتباه و دستکاری بسته رد می‌شوند', () => {
  const k1 = relayCrypto.deriveRelayKeys('SimpleKey-A1')
  const k2 = relayCrypto.deriveRelayKeys('SimpleKey-B2')
  const aad = Buffer.from('torob-relay-req-v1', 'utf8')

  const env = relayCrypto.encryptRelayEnvelope(k1.reqKey, aad, { op: 'ping', ts: 123 })
  assert.deepEqual(relayCrypto.decryptRelayEnvelope(k1.reqKey, aad, env), { op: 'ping', ts: 123 })
  assert.equal(relayCrypto.decryptRelayEnvelope(k2.reqKey, aad, env), null)

  const tampered = { ...env, tag: env.tag.slice(0, -2) + 'AA' }
  assert.equal(relayCrypto.decryptRelayEnvelope(k1.reqKey, aad, tampered), null)
})

test('R4. سرویس واقعی scripts/torob-relay.mjs: کلید درست، کلید غلط، ضد-Replay، ضد-SSRF و 404 روی اسکن', async () => {
  const port = await freePort()
  const key = 'SimpleHomeKey2026'
  const child = spawn(process.execPath, ['scripts/torob-relay.mjs', `--port=${port}`, '--host=127.0.0.1', `--key=${key}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    const up = await waitForPort(port)
    assert.ok(up, 'رله باید سریع روی پورت تست بالا بیاید')

    // ۱. اسکن ساده GET باید 404 بگیرد (بدون افشای هویت سرویس)
    const scan = await fetch(`http://127.0.0.1:${port}/`)
    assert.equal(scan.status, 404)

    // ۲. کلید صحیح -> ping موفق
    const pingOk = await relayCrypto.pingEncryptedRelay({
      relayUrl: `http://127.0.0.1:${port}`,
      relayKey: key,
      checkTorob: false,
    })
    assert.equal(pingOk.ok, true)
    assert.equal(typeof pingOk.relayTs, 'number')

    // ۳. کلید اشتباه -> خطای احراز هویت (HTTP 401)
    await assert.rejects(
      () => relayCrypto.pingEncryptedRelay({ relayUrl: `http://127.0.0.1:${port}`, relayKey: 'WrongKey999', checkTorob: false }),
      (err) => err && err.kind === 'auth' && err.status === 401,
    )

    // ۴. ضد-SSRF: مسیر خارج از /v4/ رد می‌شود
    const ssrf = await relayCrypto.fetchViaEncryptedRelay({
      relayUrl: `http://127.0.0.1:${port}`,
      relayKey: key,
      target: 'api',
      path: '/../../etc/passwd',
    })
    assert.match(String(ssrf.error || ''), /Disallowed/)

    const protoRel = await relayCrypto.fetchViaEncryptedRelay({
      relayUrl: `http://127.0.0.1:${port}`,
      relayKey: key,
      target: 'api',
      path: '//127.0.0.1:3050/api/products',
    })
    assert.match(String(protoRel.error || ''), /Disallowed/)

    // ۵. ضد-Replay: ارسال تکراری همان بسته رمزنگاری‌شده رد می‌شود
    const { reqKey } = relayCrypto.deriveRelayKeys(key)
    const env = relayCrypto.encryptRelayEnvelope(reqKey, Buffer.from('torob-relay-req-v1', 'utf8'), {
      v: 1,
      ts: Date.now(),
      nonce: '0123456789abcdef0123456789abcdef',
      op: 'ping',
    })
    const first = await fetch(`http://127.0.0.1:${port}/_relay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(env),
    })
    assert.equal(first.status, 200)
    const replay = await fetch(`http://127.0.0.1:${port}/_relay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(env),
    })
    assert.equal(replay.status, 401)
  } finally {
    child.kill()
  }
})

test('R5. همگام‌سازی زنده پنل با vendor/torob-mcp روی HTTP و حفظ محرمانگی کلید', async () => {
  const port = await freePort()
  const home = mkdtempSync(join(tmpdir(), 'torob-mcp-relay-test-'))
  const syncSecret = 'InternalSyncTestSecret123'
  const child = spawn(process.execPath, ['vendor/torob-mcp/dist/index.js', '--http'], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      TOROB_MCP_HOME: home,
      TOROB_MCP_SYNC_SECRET: syncSecret,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    const up = await waitForPort(port)
    assert.ok(up, 'torob-mcp باید روی پورت تست بالا بیاید')

    // بدون راز همگام‌سازی باید 401 بدهد
    const unauth = await fetch(`http://127.0.0.1:${port}/relay-status`)
    assert.equal(unauth.status, 401)

    // با راز همگام‌سازی، تنظیم رله رمزنگاری‌شده اعمال می‌شود و کلید در status برنمی‌گردد
    const push = await fetch(`http://127.0.0.1:${port}/relay-config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-sync-secret': syncSecret },
      body: JSON.stringify({
        enabled: true,
        mode: 'encrypted_relay',
        url: 'http://2.180.37.182:43389',
        key: 'MyTorobKey2026',
        digest: 'abc123def456',
      }),
    })
    assert.equal(push.status, 200)
    const json = await push.json()
    assert.equal(json.ok, true)
    assert.equal(json.enabled, true)
    assert.equal(json.mode, 'encrypted_relay')
    assert.equal(json.url, 'http://2.180.37.182:43389')
    assert.equal(json.hasKey, true)
    assert.equal(json.digest, 'abc123def456')
    assert.equal('key' in json, false, 'کلید خام نباید در خروجی status برگردد')
  } finally {
    child.kill()
    rmSync(home, { recursive: true, force: true })
  }
})

test('R6. torob-mcp/dist/http.js در حالت encrypted_relay درخواست‌های نسبی و details_url را از رله عبور می‌دهد', async () => {
  const httpMod = await import('../vendor/torob-mcp/dist/http.js')
  const captured = []
  httpMod.setPaceForTests(0)
  httpMod.setEncryptedRelayTransport(async (opts) => {
    captured.push(opts)
    return {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, results: [] }),
    }
  })
  try {
    httpMod.setRelayRuntimeConfig({
      enabled: true,
      url: 'http://2.180.37.182:43389/',
      key: 'MyTorobKey2026',
      digest: 'd1',
    })
    await httpMod.torobGet('/v4/base-product/search/?q=phone')
    await httpMod.torobGet('https://api.torob.com/v4/base-product/details/?search_id=s1&prk=abc')

    assert.equal(captured.length, 2)
    assert.equal(captured[0].url, 'http://2.180.37.182:43389')
    assert.equal(captured[0].key, 'MyTorobKey2026')
    assert.equal(captured[0].path, '/v4/base-product/search/?q=phone')
    assert.equal(captured[1].path, '/v4/base-product/details/?search_id=s1&prk=abc')
  } finally {
    httpMod.setRelayRuntimeConfig({ enabled: false, url: '', key: '', digest: '' })
    httpMod.setEncryptedRelayTransport(null)
  }
})
