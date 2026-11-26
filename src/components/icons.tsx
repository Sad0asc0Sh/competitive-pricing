import type { ReactNode } from "react";

/**
 * آیکون‌های خطی سبک (stroke) بدون وابستگی خارجی — هم‌سبک Lucide، با مسیرهای ساده دست‌ساز.
 * همه با stroke=currentColor و viewBox 24 رسم می‌شوند تا با رنگ متن کنترل شوند.
 */
type P = { className?: string };

function base(path: ReactNode, className?: string) {
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

export const IconSearch = ({ className }: P) =>
  base(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>,
    className,
  );

export const IconFilter = ({ className }: P) =>
  base(<path d="M3 5h18l-7 8.5v5l-4 2v-7L3 5Z" />, className);

export const IconPlus = ({ className }: P) =>
  base(<path d="M12 5v14M5 12h14" />, className);

export const IconChevronDown = ({ className }: P) =>
  base(<path d="m6 9 6 6 6-6" />, className);

export const IconChevronLeft = ({ className }: P) =>
  base(<path d="m15 6-6 6 6 6" />, className);

export const IconChevronRight = ({ className }: P) =>
  base(<path d="m9 6 6 6-6 6" />, className);

export const IconPanelCollapse = ({ className }: P) =>
  base(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16M9.5 9.5 12 12l-2.5 2.5" />
    </>,
    className,
  );

export const IconPanelExpand = ({ className }: P) =>
  base(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16M11.5 9.5 9 12l2.5 2.5" />
    </>,
    className,
  );

export const IconCheck = ({ className }: P) =>
  base(<path d="m5 12.5 4.5 4.5L19 7" />, className);

export const IconAlert = ({ className }: P) =>
  base(
    <>
      <path d="M12 3.5 2.8 19.5a1.2 1.2 0 0 0 1 1.8h16.4a1.2 1.2 0 0 0 1-1.8L12 3.5Z" />
      <path d="M12 10v4.5M12 17.8h.01" />
    </>,
    className,
  );

export const IconTrash = ({ className }: P) =>
  base(
    <>
      <path d="M4 7h16M9.5 4h5M7 7l1 13h8l1-13" />
      <path d="M10 11v5M14 11v5" />
    </>,
    className,
  );

export const IconRefresh = ({ className }: P) =>
  base(
    <>
      <path d="M20 11a8 8 0 0 0-14.3-4.6L3 9M4 13a8 8 0 0 0 14.3 4.6L21 15" />
      <path d="M3 4v5h5M21 20v-5h-5" />
    </>,
    className,
  );

export const IconEye = ({ className }: P) =>
  base(
    <>
      <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>,
    className,
  );

export const IconEyeOff = ({ className }: P) =>
  base(
    <>
      <path d="M3 3l18 18" />
      <path d="M10.5 6.2A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a16.7 16.7 0 0 1-3.2 4.1M6.4 6.7A16.7 16.7 0 0 0 2.5 12s3.5 6 9.5 6a9.6 9.6 0 0 0 4.5-1.1" />
    </>,
    className,
  );

export const IconExternalLink = ({ className }: P) =>
  base(
    <>
      <path d="M14 4h6v6M10 14 20 4" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </>,
    className,
  );

export const IconSliders = ({ className }: P) =>
  base(
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="9" cy="6" r="2" fill="currentColor" />
      <circle cx="15" cy="12" r="2" fill="currentColor" />
      <circle cx="11" cy="18" r="2" fill="currentColor" />
    </>,
    className,
  );

export const IconSparkles = ({ className }: P) =>
  base(
    <>
      <path d="m12 3 1.8 4.8L18.5 9.5l-4.7 1.7L12 16l-1.8-4.8-4.7-1.7 4.7-1.7L12 3Z" />
      <path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" />
    </>,
    className,
  );

export const IconSpinner = ({ className }: P) => (
  <svg
    className={`animate-spin ${className ?? "h-4 w-4"}`}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

export const IconGrid = ({ className }: P) =>
  base(
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>,
    className,
  );

export const IconTable = ({ className }: P) =>
  base(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M9 10v10" />
    </>,
    className,
  );

export const IconArrowRight = ({ className }: P) =>
  base(<path d="M5 12h14M13 6l6 6-6 6" />, className);

export const IconCommand = ({ className }: P) =>
  base(
    <>
      <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3Z" />
    </>,
    className,
  );

export const IconCheckCircle = ({ className }: P) =>
  base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </>,
    className,
  );

export const IconXCircle = ({ className }: P) =>
  base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9.5 9.5 5 5M14.5 9.5l-5 5" />
    </>,
    className,
  );

export const IconInfo = ({ className }: P) =>
  base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>,
    className,
  );

export const IconMore = ({ className }: P) =>
  base(
    <>
      <circle cx="6" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="18" cy="12" r="1.4" fill="currentColor" />
    </>,
    className,
  );
