/** Embedded cloud sign-in card used only inside an authenticated renderer transition. */
import { SignInCard } from './SignInCard'

/** Render account authentication without offering a signed-out local-workspace bypass. */
export function CloudSignInGate(): React.JSX.Element {
  return (
    <div className="cloud-signin-gate">
      <SignInCard />
    </div>
  )
}
