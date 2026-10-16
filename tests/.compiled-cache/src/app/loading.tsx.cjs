"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = Loading;
function Loading() {
  return <div className="space-y-6" aria-busy="true" aria-label="در حال بارگذاری">
      <div className="skeleton h-9 w-64 max-w-full" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="skeleton h-24" />
        <div className="skeleton h-24" />
        <div className="skeleton h-24" />
        <div className="skeleton h-24" />
      </div>
      <div className="skeleton h-64" />
    </div>;
}