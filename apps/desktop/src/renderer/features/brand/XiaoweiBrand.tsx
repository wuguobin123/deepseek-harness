import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import xiaoweiLogo from './xiaowei-logo.png'

type XiaoweiBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/** Required service: the desktop UI slot registry. */
export const inject = ['slots']

/**
 * Render the Xiaowei product mark at the size requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns The Xiaowei logo image.
 */
export function XiaoweiBrandMark({ size, className }: XiaoweiBrandMarkProps): React.JSX.Element {
  return (
    <img
      src={xiaoweiLogo}
      alt=""
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      style={{ display: 'block', objectFit: 'contain' }}
    />
  )
}

/**
 * Render the Xiaowei product name independently from the mark.
 * @returns The Xiaowei product name.
 */
export function XiaoweiBrandName(): React.JSX.Element {
  return <span>小薇</span>
}

/**
 * Fill every desktop brand slot with Xiaowei-owned presentation.
 * @param ctx - Desktop client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, XiaoweiBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, XiaoweiBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, XiaoweiBrandMark)
      })))
}
