import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * What Orbit shows when one of its own components throws.
 *
 * React unmounts the whole tree when a render throws and nothing catches it, so
 * the window keeps its dark background and nothing else: a blank app with no
 * words in it, which is indistinguishable from an app that never started. That
 * is exactly what a mistyped variable in one page did once, and it cost an
 * afternoon of guessing at a build that was fine.
 *
 * So the shell is wrapped. A crash still leaves the window, the title bar and
 * the way out intact - the app is broken, not gone - and it says which component
 * and what the error was, with a button that puts the tree back. Reloading is
 * the fallback rather than the only move, because a reload of a broken build is
 * just as blank.
 */
export class CrashScreen extends Component<
  { children: ReactNode },
  { error: Error | null; component: string }
> {
  state: { error: Error | null; component: string } = { error: null, component: '' };

  static getDerivedStateFromError(error: Error) {
    return { error, component: '' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The component stack is the part that says *which* page threw; the message
    // alone rarely names it.
    const first = (info.componentStack ?? '')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    this.setState({ error, component: first ?? '' });
    // Kept in the console too, so launching from a terminal still prints it.
    console.error('Orbit crashed while drawing', error, info.componentStack);
  }

  render() {
    const { error, component } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="grid min-h-screen place-items-center bg-bg px-6 py-10 text-fg">
        <div className="w-full max-w-xl">
          <p className="orbit-kicker">Orbit</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">Something in this screen broke</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The rest of Orbit is still here - the window did not fail to start. Drawing
            {component ? ` ${component.replace(/^at\s+/, '')}` : ' this page'} threw the error below.
            Try again, and if it comes back, it is a bug worth reporting.
          </p>

          <pre className="mt-5 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-panel px-3 py-2.5 text-[11.5px] leading-relaxed text-rose-300">
            {error.message || String(error)}
          </pre>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null, component: '' })}
              className="btn-accent rounded-lg px-4 py-2 text-sm font-semibold"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:border-accent hover:text-fg"
            >
              Reload Orbit
            </button>
          </div>
        </div>
      </div>
    );
  }
}
