export default function Loading() {
  return (
    <div className="space-y-5 sm:space-y-6" aria-busy="true" aria-label="در حال بارگذاری">
      <div className="space-y-3">
        <div className="skeleton h-8 w-72 max-w-full" />
        <div className="flex flex-wrap gap-2">
          <div className="skeleton h-7 w-36 rounded-full" />
          <div className="skeleton h-7 w-40 rounded-full" />
          <div className="skeleton h-7 w-32 rounded-full" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="skeleton h-24 rounded-2xl" />
        <div className="skeleton h-24 rounded-2xl" />
        <div className="skeleton h-24 rounded-2xl" />
        <div className="skeleton h-24 rounded-2xl" />
      </div>

      <div className="skeleton h-64 rounded-2xl" />
    </div>
  );
}
