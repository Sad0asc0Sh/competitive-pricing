/**
 * آیکون‌های خطی سبک (stroke) بدون وابستگی خارجی — هم‌سبک Lucide، با مسیرهای ساده دست‌ساز.
 * همه با stroke=currentColor و viewBox 24 رسم می‌شوند تا با رنگ متن کنترل شوند.
 */
type P = { className?: string };

function base(path: React.ReactNode, className?: string) {
  return (
    <svg
      className={className ?? "h-5 w-5"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

export const IconDashboard = ({ className }: P) =>
  base(
    <>
      <rect x="3" y="3" width="7.5" height="9" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="5.5" rx="1.5" />
      <rect x="13.5" y="12" width="7.5" height="9" rx="1.5" />
      <rect x="3" y="15.5" width="7.5" height="5.5" rx="1.5" />
    </>,
    className,
  );

export const IconProducts = ({ className }: P) =>
  base(
    <>
      <path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" />
      <path d="M4 7l8 4 8-4" />
      <path d="M12 11v10" />
    </>,
    className,
  );

export const IconReview = ({ className }: P) =>
  base(
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4.5V3h6v1.5" />
      <path d="m9 14.5 2 2 4-4.5" />
    </>,
    className,
  );

export const IconRuns = ({ className }: P) =>
  base(
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3.5 2" />
    </>,
    className,
  );

export const IconCampaigns = ({ className }: P) =>
  base(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
      <circle cx="12" cy="12" r="0.5" fill="currentColor" />
    </>,
    className,
  );

export const IconSettings = ({ className }: P) =>
  base(
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8" />
    </>,
    className,
  );

export const IconSimulate = ({ className }: P) =>
  base(
    <>
      <path d="M9 3h6" />
      <path d="M10 3v6L4.8 18a2 2 0 0 0 1.8 3h10.8a2 2 0 0 0 1.8-3L14 9V3" />
      <path d="M7.5 15h9" />
    </>,
    className,
  );

export const IconDocs = ({ className }: P) =>
  base(
    <>
      <path d="M6 2.8h8L19 8v13.2H6z" />
      <path d="M13.5 3v5.5H19" />
      <path d="M9 13h6M9 16.5h6" />
    </>,
    className,
  );

export const IconMenu = ({ className }: P) =>
  base(
    <>
      <path d="M4 7h16M4 12h16M4 17h10" />
    </>,
    className,
  );

export const IconClose = ({ className }: P) =>
  base(
    <>
      <path d="M6 6l12 12M18 6L6 18" />
    </>,
    className,
  );

export const IconLogout = ({ className }: P) =>
  base(
    <>
      <path d="M14 4h-7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7" />
      <path d="M10 12h11M18 8.5 21.5 12 18 15.5" />
    </>,
    className,
  );

export const IconShield = ({ className }: P) =>
  base(
    <>
      <path d="M12 3 5 5.8v5.4c0 4.6 3 8 7 9.8 4-1.8 7-5.2 7-9.8V5.8L12 3Z" />
      <path d="m9 11.8 2.2 2.2 4-4.4" />
    </>,
    className,
  );

export const IconBolt = ({ className }: P) =>
  base(<path d="M13 2.5 4.5 13.5H11L9.8 21.5 19 10h-6.5L13 2.5Z" />, className);
