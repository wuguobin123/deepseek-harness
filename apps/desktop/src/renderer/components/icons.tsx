/**
 * Inline stroke icons (currentColor), 16px grid, Lucide-style.
 * Kept dependency-free so the renderer bundle stays small and CSP-clean.
 */
import React from 'react'

interface IconProps {
  size?: number
  className?: string
}

function base(
  paths: React.ReactNode,
  { size = 16, className }: IconProps,
): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {paths}
    </svg>
  )
}

export function IconAlert(props: IconProps): React.JSX.Element {
  return base(
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>,
    props,
  )
}

export function IconBolt(props: IconProps): React.JSX.Element {
  return base(
    <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />,
    props,
  )
}

export function IconClock(props: IconProps): React.JSX.Element {
  return base(
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3.5 2" />
    </>,
    props,
  )
}

export function IconBook(props: IconProps): React.JSX.Element {
  return base(
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </>,
    props,
  )
}

export function IconGear(props: IconProps): React.JSX.Element {
  return base(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87 1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z" />
    </>,
    props,
  )
}

export function IconRefresh(props: IconProps): React.JSX.Element {
  return base(
    <>
      <path d="M21 12a9 9 0 1 1-2.6-6.4" />
      <path d="M21 3v6h-6" />
    </>,
    props,
  )
}

export function IconArrowLeft(props: IconProps): React.JSX.Element {
  return base(
    <>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </>,
    props,
  )
}

export function IconArrowRight(props: IconProps): React.JSX.Element {
  return base(
    <>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </>,
    props,
  )
}

export function IconGlobe(props: IconProps): React.JSX.Element {
  return base(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 0 18" />
      <path d="M12 3a15 15 0 0 0 0 18" />
    </>,
    props,
  )
}

export function IconInbox(props: IconProps): React.JSX.Element {
  return base(
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1Z" />
    </>,
    props,
  )
}

export function IconExternal(props: IconProps): React.JSX.Element {
  return base(
    <>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </>,
    props,
  )
}

export function IconSend(props: IconProps): React.JSX.Element {
  return base(
    <>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </>,
    props,
  )
}

export function IconLogo(props: IconProps): React.JSX.Element {
  return base(
    <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" fill="currentColor" stroke="none" />,
    props,
  )
}

export function IconPhone(props: IconProps): React.JSX.Element {
  return base(
    <>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.4 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.6 1.9Z" />
    </>,
    props,
  )
}

export function IconHome(props: IconProps): React.JSX.Element {
  return base(
    <>
      <path d="m3 10 9-7 9 7" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M9 21v-7h6v7" />
    </>,
    props,
  )
}

export function IconTask(props: IconProps): React.JSX.Element {
  return base(
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>,
    props,
  )
}

export function IconApproval(props: IconProps): React.JSX.Element {
  return base(
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M3 21v-2a6 6 0 0 1 9.5-4.9" />
      <path d="m16 19 2 2 4-5" />
    </>,
    props,
  )
}

export function IconRobot(props: IconProps): React.JSX.Element {
  return base(
    <>
      <rect x="4" y="7" width="16" height="12" rx="3" />
      <path d="M12 3v4M8 12h.01M16 12h.01M8 16h8" />
    </>,
    props,
  )
}

export function IconPlug(props: IconProps): React.JSX.Element {
  return base(
    <>
      <path d="M12 22v-5" />
      <path d="M9 8V2M15 8V2" />
      <path d="M18 8v3a6 6 0 0 1-12 0V8Z" />
    </>,
    props,
  )
}

export function IconSparkles(props: IconProps): React.JSX.Element {
  return base(
    <>
      <path d="m12 3-1.2 3.8L7 8l3.8 1.2L12 13l1.2-3.8L17 8l-3.8-1.2Z" />
      <path d="m5 14-.7 2.3L2 17l2.3.7L5 20l.7-2.3L8 17l-2.3-.7Z" />
      <path d="m19 13-.7 2.3L16 16l2.3.7L19 19l.7-2.3L22 16l-2.3-.7Z" />
    </>,
    props,
  )
}

export function IconClose(props: IconProps): React.JSX.Element {
  return base(<path d="m6 6 12 12M18 6 6 18" />, props)
}

export function IconPlay(props: IconProps): React.JSX.Element {
  return base(<path d="m8 5 11 7-11 7Z" />, props)
}

export function IconLayoutGrid(props: IconProps): React.JSX.Element {
  return base(
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>,
    props,
  )
}

export function IconPanelRight(props: IconProps): React.JSX.Element {
  return base(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="15" y1="4" x2="15" y2="20" />
    </>,
    props,
  )
}

export function IconStop(props: IconProps): React.JSX.Element {
  return base(<rect x="6" y="6" width="12" height="12" rx="1.5" />, props)
}

export function IconSearch(props: IconProps): React.JSX.Element {
  return base(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>,
    props,
  )
}

export function IconFile(props: IconProps): React.JSX.Element {
  return base(
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6M8 13h8M8 17h6" />
    </>,
    props,
  )
}

export function IconPaperclip(props: IconProps): React.JSX.Element {
  return base(
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />,
    props,
  )
}

export function IconChevronRight(props: IconProps): React.JSX.Element {
  return base(<path d="m9 18 6-6-6-6" />, props)
}

export function IconBell(props: IconProps): React.JSX.Element {
  return base(
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </>,
    props,
  )
}

export function IconShield(props: IconProps): React.JSX.Element {
  return base(
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </>,
    props,
  )
}

export function IconDownload(props: IconProps): React.JSX.Element {
  return base(
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </>,
    props,
  )
}

export function IconEye(props: IconProps): React.JSX.Element {
  return base(
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>,
    props,
  )
}

export function IconFileWord(props: IconProps): React.JSX.Element {
  return base(
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path
        d="M8 13l1.5 5 1.5-3 1.5 3 1.5-5"
        strokeWidth={1.5}
      />
    </>,
    props,
  )
}

export function IconFileExcel(props: IconProps): React.JSX.Element {
  return base(
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="m9 13 3 3m0 0 3 3m-3-3-3 3m3-3 3-3" />
    </>,
    props,
  )
}

export function IconFilePpt(props: IconProps): React.JSX.Element {
  return base(
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h2.5a1.5 1.5 0 0 1 0 3H9v2" />
    </>,
    props,
  )
}

export function IconFilePdf(props: IconProps): React.JSX.Element {
  return base(
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h2a1.5 1.5 0 0 1 0 3H8v2" />
      <path d="M12.5 13h1.5a1.5 1.5 0 0 1 0 3h-1.5v-3Z" />
    </>,
    props,
  )
}

export function IconFileText(props: IconProps): React.JSX.Element {
  return base(
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h6M8 9h3" />
    </>,
    props,
  )
}

export function IconExternalLink(props: IconProps): React.JSX.Element {
  // 在系统默认浏览器打开（“跳出”图标）。
  return <IconExternal {...props} />
}
