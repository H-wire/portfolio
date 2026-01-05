import type { FormEvent } from "react";

export type HeroSectionProps = {
  isAuthed: boolean;
  authReady: boolean;
  meLoading: boolean;
  email: string;
  password: string;
  authError: string | null;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onLogin: (event: FormEvent<HTMLFormElement>) => void;
};

export function HeroSection(props: HeroSectionProps) {
  return (
    <header className="hero">
      <div>
        <p className="eyebrow">Haborn Invest & Consulting</p>
        <h1>Portfolio Command Deck</h1>
        <p className="subtitle">Monthly recommendations, allocation, and performance at a glance.</p>
      </div>
      <div className="hero-card">
        <h2>Session</h2>
        {props.isAuthed ? (
          <div className="badge">Authenticated</div>
        ) : props.authReady && props.meLoading ? (
          <div className="badge">Checking session...</div>
        ) : (
          <form onSubmit={props.onLogin} className="login-form">
            <label>
              Email
              <input value={props.email} onChange={(e) => props.onEmailChange(e.target.value)} />
            </label>
            <label>
              Password
              <input
                type="password"
                value={props.password}
                onChange={(e) => props.onPasswordChange(e.target.value)}
              />
            </label>
            {props.authError && <p className="error">{props.authError}</p>}
            <button type="submit">Sign in</button>
          </form>
        )}
      </div>
    </header>
  );
}
