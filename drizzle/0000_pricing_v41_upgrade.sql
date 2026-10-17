CREATE TABLE "activity_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"level" varchar(10) DEFAULT 'info' NOT NULL,
	"scope" varchar(50) NOT NULL,
	"message" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"decision_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"shop_name" text NOT NULL,
	"shop_id" text,
	"shop_city" text,
	"seller_type" varchar(20) DEFAULT 'online' NOT NULL,
	"shop_score" real,
	"is_local_city" boolean DEFAULT false NOT NULL,
	"price_unreliable" boolean DEFAULT false NOT NULL,
	"price" integer NOT NULL,
	"last_changed_at" timestamp,
	"is_ad" boolean DEFAULT false NOT NULL,
	"in_stock" boolean DEFAULT true NOT NULL,
	"url" text,
	"included" boolean DEFAULT true NOT NULL,
	"exclude_reason" text,
	"weight" real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discount_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" varchar(30) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"min_discount_pct" real DEFAULT 0 NOT NULL,
	"max_discount_pct" real DEFAULT 100 NOT NULL,
	"badge_theme" varchar(30) DEFAULT 'green-orange' NOT NULL,
	"show_in_featured" boolean DEFAULT true NOT NULL,
	"card_range_from" integer DEFAULT 1 NOT NULL,
	"card_range_to" integer DEFAULT 0 NOT NULL,
	"max_cards" integer DEFAULT 0 NOT NULL,
	"min_price_toman" integer DEFAULT 0 NOT NULL,
	"max_price_toman" integer DEFAULT 0 NOT NULL,
	"only_top_ranked" boolean DEFAULT false NOT NULL,
	"target_product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active_hours" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active_days" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_hours" integer DEFAULT 24 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer,
	"product_id" integer NOT NULL,
	"source" varchar(30) NOT NULL,
	"offers_total" integer DEFAULT 0 NOT NULL,
	"offers_used" integer DEFAULT 0 NOT NULL,
	"effective_cost_price" integer,
	"hard_floor_price" integer,
	"lowest_raw" integer,
	"lowest_valid" integer,
	"monitored_market_ceiling" integer,
	"local_lowest_valid" integer,
	"market_median" integer,
	"market_mean" integer,
	"reference_price" integer,
	"base_price" integer,
	"final_price" integer,
	"discount_pct" real,
	"campaign_type" varchar(30),
	"campaign_name" text,
	"badge_theme" varchar(30),
	"show_in_featured" boolean DEFAULT true NOT NULL,
	"strategy" varchar(40),
	"competition_tier" varchar(40),
	"projected_national_rank" integer,
	"projected_local_rank" integer,
	"net_profit_toman" integer,
	"net_margin_pct" real,
	"confidence" real DEFAULT 0 NOT NULL,
	"status" varchar(30) NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"engine_version" varchar(20) DEFAULT '4.1.1' NOT NULL,
	"market_conflict" boolean DEFAULT false NOT NULL,
	"reference_kind" varchar(30),
	"floor_confirmed" boolean DEFAULT false NOT NULL,
	"push_status" varchar(30),
	"push_error" text,
	"pushed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"trigger" varchar(30) NOT NULL,
	"status" varchar(30) DEFAULT 'running' NOT NULL,
	"schedule_id" integer,
	"total_products" integer DEFAULT 0 NOT NULL,
	"applied" integer DEFAULT 0 NOT NULL,
	"pending_review" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "pricing_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"sku" varchar(100) NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"store_external_id" text,
	"source_type" varchar(30) DEFAULT 'torob' NOT NULL,
	"torob_url" text,
	"torob_prk" text,
	"torob_details_url" text,
	"cost_price" integer DEFAULT 0 NOT NULL,
	"replacement_cost" integer,
	"replacement_cost_at" timestamp,
	"current_campaign_ends_at" timestamp,
	"locked_until" timestamp,
	"needs_refresh" boolean DEFAULT false NOT NULL,
	"supplier_quotes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_supplier_name" text,
	"current_hard_floor_price" integer,
	"min_margin_pct" real,
	"min_profit_amount" integer,
	"preferred_campaign_type" varchar(30) DEFAULT 'auto' NOT NULL,
	"show_in_featured" boolean DEFAULT true NOT NULL,
	"profile_id" integer,
	"auto_apply" boolean DEFAULT true NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"current_base_price" integer,
	"current_final_price" integer,
	"current_discount_pct" real,
	"current_campaign" varchar(30),
	"current_campaign_name" text,
	"current_badge_theme" varchar(30) DEFAULT 'green-orange',
	"current_show_in_featured" boolean DEFAULT false,
	"last_decision_id" integer,
	"last_checked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"interval_minutes" integer DEFAULT 360 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_connectors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" varchar(30) NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_push_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "competitor_offers" ADD CONSTRAINT "competitor_offers_decision_id_price_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."price_decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_decisions" ADD CONSTRAINT "price_decisions_run_id_price_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."price_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_decisions" ADD CONSTRAINT "price_decisions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_profile_id_pricing_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."pricing_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offers_decision_idx" ON "competitor_offers" USING btree ("decision_id");--> statement-breakpoint
CREATE INDEX "decisions_product_idx" ON "price_decisions" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "decisions_run_idx" ON "price_decisions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "products_status_idx" ON "products" USING btree ("status");