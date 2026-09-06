type IconName =
  | 'arrow-left'
  | 'arrow-right'
  | 'batch'
  | 'card'
  | 'chevron-right'
  | 'clock'
  | 'document'
  | 'lock'
  | 'plus'
  | 'refresh'
  | 'search'
  | 'shield'
  | 'user';

type IconProps = {
  className?: string;
  name: IconName;
};

export function Icon({ className, name }: IconProps) {
  const common = {
    'aria-hidden': true,
    className,
    fill: 'none',
    focusable: false,
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.8,
    viewBox: '0 0 24 24',
  };

  switch (name) {
    case 'arrow-left':
      return (
        <svg {...common}>
          <path d="m15 18-6-6 6-6" />
          <path d="M9 12h10" />
        </svg>
      );
    case 'arrow-right':
      return (
        <svg {...common}>
          <path d="m9 18 6-6-6-6" />
          <path d="M5 12h10" />
        </svg>
      );
    case 'batch':
      return (
        <svg {...common}>
          <path d="m4 7 8-4 8 4-8 4-8-4Z" />
          <path d="m4 12 8 4 8-4" />
          <path d="m4 17 8 4 8-4" />
        </svg>
      );
    case 'card':
      return (
        <svg {...common}>
          <rect height="16" rx="2" width="18" x="3" y="4" />
          <path d="M7 8h7M7 12h10M7 16h6" />
        </svg>
      );
    case 'chevron-right':
      return (
        <svg {...common}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'document':
      return (
        <svg {...common}>
          <path d="M6 3h8l4 4v14H6V3Z" />
          <path d="M14 3v5h5M9 12h6M9 16h6" />
        </svg>
      );
    case 'lock':
      return (
        <svg {...common}>
          <rect height="10" rx="2" width="16" x="4" y="11" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case 'refresh':
      return (
        <svg {...common}>
          <path d="M20 7v5h-5" />
          <path d="M4 17v-5h5" />
          <path d="M6.1 9a7 7 0 0 1 11.4-2.6L20 9M4 15l2.5 2.6A7 7 0 0 0 17.9 15" />
        </svg>
      );
    case 'search':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="m16.5 16.5 4 4" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...common}>
          <path d="M12 3 5 6v5c0 4.7 2.8 8.2 7 10 4.2-1.8 7-5.3 7-10V6l-7-3Z" />
          <path d="m9 12 2 2 4-5" />
        </svg>
      );
    case 'user':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
        </svg>
      );
  }
}
