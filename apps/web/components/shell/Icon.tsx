/**
 * Icon — inline SVG icon set tuned for the Quip-inspired chrome.
 *
 * 24x24 viewbox, 1.75 stroke, currentColor. Paths sourced from open icon
 * systems (Lucide / Tabler conventions) and adapted to the Lash palette.
 */
import type { SVGProps } from 'react';

export type IconName =
  | 'document'
  | 'documents'
  | 'home'
  | 'star'
  | 'starred'
  | 'inbox'
  | 'people'
  | 'gear'
  | 'menu'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-up'
  | 'check'
  | 'close'
  | 'plus'
  | 'share'
  | 'history'
  | 'message'
  | 'sparkles'
  | 'lock'
  | 'cloud'
  | 'eye'
  | 'eye-off'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'code'
  | 'link'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'list-bullet'
  | 'list-numbered'
  | 'list-check'
  | 'table'
  | 'upload'
  | 'download'
  | 'pencil'
  | 'maximize'
  | 'minimize'
  | 'bell';

const baseProps: SVGProps<SVGSVGElement> = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  name: IconName;
}

export function Icon({ name, ...props }: IconProps) {
  switch (name) {
    case 'document':
      return (
        <svg {...baseProps} {...props}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
        </svg>
      );
    case 'documents':
      return (
        <svg {...baseProps} {...props}>
          <path d="M15 3H7a2 2 0 0 0-2 2v12" />
          <path d="M19 7v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" />
        </svg>
      );
    case 'home':
      return (
        <svg {...baseProps} {...props}>
          <path d="M3 11l9-7 9 7" />
          <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
        </svg>
      );
    case 'star':
      return (
        <svg {...baseProps} {...props}>
          <path d="M12 3l2.7 6 6.3.6-4.8 4.4 1.4 6.4L12 17l-5.6 3.4L7.8 14 3 9.6 9.3 9z" />
        </svg>
      );
    case 'starred':
      return (
        <svg {...baseProps} {...props} fill="currentColor">
          <path d="M12 3l2.7 6 6.3.6-4.8 4.4 1.4 6.4L12 17l-5.6 3.4L7.8 14 3 9.6 9.3 9z" />
        </svg>
      );
    case 'inbox':
      return (
        <svg {...baseProps} {...props}>
          <path d="M22 13h-6l-2 3h-4l-2-3H2" />
          <path d="M5.45 5.11L2 13v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-7.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </svg>
      );
    case 'people':
      return (
        <svg {...baseProps} {...props}>
          <path d="M17 20v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 20v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'gear':
      return (
        <svg {...baseProps} {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    case 'menu':
      return (
        <svg {...baseProps} {...props}>
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      );
    case 'chevron-left':
      return (
        <svg {...baseProps} {...props}>
          <polyline points="15 6 9 12 15 18" />
        </svg>
      );
    case 'chevron-right':
      return (
        <svg {...baseProps} {...props}>
          <polyline points="9 6 15 12 9 18" />
        </svg>
      );
    case 'chevron-down':
      return (
        <svg {...baseProps} {...props}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      );
    case 'chevron-up':
      return (
        <svg {...baseProps} {...props}>
          <polyline points="6 15 12 9 18 15" />
        </svg>
      );
    case 'check':
      return (
        <svg {...baseProps} {...props}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    case 'close':
      return (
        <svg {...baseProps} {...props}>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...baseProps} {...props}>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      );
    case 'share':
      return (
        <svg {...baseProps} {...props}>
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
      );
    case 'history':
      return (
        <svg {...baseProps} {...props}>
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <polyline points="3 3 3 8 8 8" />
          <polyline points="12 7 12 12 15 14" />
        </svg>
      );
    case 'message':
      return (
        <svg {...baseProps} {...props}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    case 'sparkles':
      return (
        <svg {...baseProps} {...props}>
          <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
          <path d="M19 14l.75 2.25L22 17l-2.25.75L19 20l-.75-2.25L16 17l2.25-.75z" />
          <path d="M5 4l.5 1.5L7 6l-1.5.5L5 8l-.5-1.5L3 6l1.5-.5z" />
        </svg>
      );
    case 'lock':
      return (
        <svg {...baseProps} {...props}>
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      );
    case 'cloud':
      return (
        <svg {...baseProps} {...props}>
          <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
        </svg>
      );
    case 'eye':
      return (
        <svg {...baseProps} {...props}>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'eye-off':
      return (
        <svg {...baseProps} {...props}>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      );
    case 'bold':
      return (
        <svg {...baseProps} {...props}>
          <path d="M7 5h6.5a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />
        </svg>
      );
    case 'italic':
      return (
        <svg {...baseProps} {...props}>
          <line x1="19" y1="4" x2="10" y2="4" />
          <line x1="14" y1="20" x2="5" y2="20" />
          <line x1="15" y1="4" x2="9" y2="20" />
        </svg>
      );
    case 'underline':
      return (
        <svg {...baseProps} {...props}>
          <path d="M6 3v9a6 6 0 0 0 12 0V3" />
          <line x1="4" y1="21" x2="20" y2="21" />
        </svg>
      );
    case 'code':
      return (
        <svg {...baseProps} {...props}>
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      );
    case 'link':
      return (
        <svg {...baseProps} {...props}>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07L11.7 5" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07L12.3 19" />
        </svg>
      );
    case 'h1':
      return (
        <svg {...baseProps} {...props}>
          <path d="M4 5v14M4 12h8M12 5v14" />
          <path d="M17 9l2-1v11" />
        </svg>
      );
    case 'h2':
      return (
        <svg {...baseProps} {...props}>
          <path d="M4 5v14M4 12h8M12 5v14" />
          <path d="M16 10a2.5 2.5 0 0 1 5 0c0 1-.5 2-2.5 3.5L16 19h5" />
        </svg>
      );
    case 'h3':
      return (
        <svg {...baseProps} {...props}>
          <path d="M4 5v14M4 12h8M12 5v14" />
          <path d="M16 8.5a2 2 0 1 1 4 0c0 1.25-1 2-2.5 2.5C19 11.5 20 12.5 20 14.5a2.5 2.5 0 0 1-5 0" />
        </svg>
      );
    case 'list-bullet':
      return (
        <svg {...baseProps} {...props}>
          <line x1="9" y1="6" x2="20" y2="6" />
          <line x1="9" y1="12" x2="20" y2="12" />
          <line x1="9" y1="18" x2="20" y2="18" />
          <circle cx="4.5" cy="6" r="1.25" fill="currentColor" />
          <circle cx="4.5" cy="12" r="1.25" fill="currentColor" />
          <circle cx="4.5" cy="18" r="1.25" fill="currentColor" />
        </svg>
      );
    case 'list-numbered':
      return (
        <svg {...baseProps} {...props}>
          <line x1="10" y1="6" x2="20" y2="6" />
          <line x1="10" y1="12" x2="20" y2="12" />
          <line x1="10" y1="18" x2="20" y2="18" />
          <path d="M4 6h2M5 4v4M4 14a1 1 0 0 1 2 0c0 1-2 1.5-2 2.5h2M4 20h2v-1H4v-1h2" strokeWidth="1.5" />
        </svg>
      );
    case 'list-check':
      return (
        <svg {...baseProps} {...props}>
          <line x1="11" y1="6" x2="21" y2="6" />
          <line x1="11" y1="12" x2="21" y2="12" />
          <line x1="11" y1="18" x2="21" y2="18" />
          <polyline points="3 6 4.5 7.5 7 5" />
          <polyline points="3 12 4.5 13.5 7 11" />
          <polyline points="3 18 4.5 19.5 7 17" />
        </svg>
      );
    case 'table':
      return (
        <svg {...baseProps} {...props}>
          <rect x="3" y="4" width="18" height="16" rx="1.5" />
          <line x1="3" y1="10" x2="21" y2="10" />
          <line x1="3" y1="15" x2="21" y2="15" />
          <line x1="10" y1="4" x2="10" y2="20" />
        </svg>
      );
    case 'upload':
      return (
        <svg {...baseProps} {...props}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      );
    case 'download':
      return (
        <svg {...baseProps} {...props}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      );
    case 'pencil':
      return (
        <svg {...baseProps} {...props}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
        </svg>
      );
    case 'maximize':
      return (
        <svg {...baseProps} {...props}>
          <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" />
        </svg>
      );
    case 'minimize':
      return (
        <svg {...baseProps} {...props}>
          <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" />
        </svg>
      );
    case 'bell':
      return (
        <svg {...baseProps} {...props}>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      );
    default:
      return null;
  }
}
