import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AccountRole, AuthState, KnowledgeBase } from '@jotmind/schemas';
import {
  createAccount,
  createKnowledgeBase,
  getMe,
  getSetupStatus,
  listKnowledgeBases,
  login,
  logout,
  setupAdmin,
} from './api.js';

type Phase = 'loading' | 'setup' | 'login' | 'authed';

export function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await getMe();
        if (cancelled) return;
        if (me) {
          setAuth(me);
          setPhase('authed');
          return;
        }
        const status = await getSetupStatus();
        if (cancelled) return;
        setPhase(status.setupRequired ? 'setup' : 'login');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <h1>JotMind</h1>
      <p>Privacy-first, self-hostable graph knowledge app.</p>
      {error && (
        <p role="alert" data-testid="app-error">
          {error}
        </p>
      )}
      {phase === 'loading' && <p data-testid="auth-loading">Loading…</p>}
      {phase === 'setup' && (
        <SetupForm
          onDone={(state) => {
            setAuth(state);
            setPhase('authed');
          }}
        />
      )}
      {phase === 'login' && (
        <LoginForm
          onDone={(state) => {
            setAuth(state);
            setPhase('authed');
          }}
        />
      )}
      {phase === 'authed' && auth && (
        <AuthedHome
          auth={auth}
          onLogout={() => {
            setAuth(null);
            setPhase('login');
          }}
        />
      )}
    </main>
  );
}

function SetupForm({ onDone }: { onDone: (state: AuthState) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await setupAdmin(email, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="first-run-setup">
      <h2>First-run setup</h2>
      <p>Create the initial administrator account.</p>
      <form onSubmit={submit}>
        <CredentialFields
          email={email}
          password={password}
          onEmail={setEmail}
          onPassword={setPassword}
        />
        <button type="submit" disabled={busy} data-testid="setup-submit">
          Create admin
        </button>
      </form>
      {error && <p data-testid="setup-error">{error}</p>}
    </section>
  );
}

function LoginForm({ onDone }: { onDone: (state: AuthState) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await login(email, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="login">
      <h2>Sign in</h2>
      <form onSubmit={submit}>
        <CredentialFields
          email={email}
          password={password}
          onEmail={setEmail}
          onPassword={setPassword}
        />
        <button type="submit" disabled={busy} data-testid="login-submit">
          Sign in
        </button>
      </form>
      {error && <p data-testid="login-error">{error}</p>}
    </section>
  );
}

function AuthedHome({ auth, onLogout }: { auth: AuthState; onLogout: () => void }) {
  const [error, setError] = useState<string | null>(null);

  async function doLogout() {
    setError(null);
    try {
      await logout(auth.csrfToken);
      onLogout();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logout failed');
    }
  }

  return (
    <section aria-label="account">
      <p data-testid="current-user">
        Signed in as {auth.user.email} ({auth.user.role})
      </p>
      <button type="button" onClick={() => void doLogout()} data-testid="logout">
        Sign out
      </button>
      <KnowledgeBases csrfToken={auth.csrfToken} />
      {auth.user.role === 'admin' && <AccountCreator csrfToken={auth.csrfToken} />}
      {error && <p data-testid="logout-error">{error}</p>}
    </section>
  );
}

function KnowledgeBases({ csrfToken }: { csrfToken: string }) {
  const [items, setItems] = useState<KnowledgeBase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setItems(await listKnowledgeBases());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Knowledge Bases');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const kb = await createKnowledgeBase(
        { name, description: description || undefined },
        csrfToken,
      );
      setName('');
      setDescription('');
      setSelectedId(kb.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create Knowledge Base');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="knowledge-bases">
      <h2>Knowledge Bases</h2>
      {items.length === 0 ? (
        <p data-testid="kb-empty">No Knowledge Bases yet. Create one to get started.</p>
      ) : (
        <ul data-testid="kb-list">
          {items.map((kb) => (
            <li key={kb.id}>
              <button
                type="button"
                aria-pressed={selectedId === kb.id}
                onClick={() => setSelectedId(kb.id)}
                data-testid={`kb-select-${kb.id}`}
              >
                {kb.name} ({kb.role}){selectedId === kb.id ? ' — selected' : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit}>
        <label>
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            data-testid="kb-name"
          />
        </label>
        <label>
          Description
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="kb-description"
          />
        </label>
        <button type="submit" disabled={busy} data-testid="kb-create-submit">
          Create Knowledge Base
        </button>
      </form>
      {error && <p data-testid="kb-error">{error}</p>}
    </section>
  );
}

function AccountCreator({ csrfToken }: { csrfToken: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AccountRole>('member');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const user = await createAccount({ email, password, role }, csrfToken);
      setMessage(`Created account ${user.email}`);
      setEmail('');
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create account');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="create-account">
      <h2>Create account</h2>
      <form onSubmit={submit}>
        <CredentialFields
          email={email}
          password={password}
          onEmail={setEmail}
          onPassword={setPassword}
        />
        <label>
          Role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as AccountRole)}
            data-testid="role-select"
          >
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <button type="submit" disabled={busy} data-testid="create-account-submit">
          Create account
        </button>
      </form>
      {message && <p data-testid="create-account-message">{message}</p>}
      {error && <p data-testid="create-account-error">{error}</p>}
    </section>
  );
}

function CredentialFields({
  email,
  password,
  onEmail,
  onPassword,
}: {
  email: string;
  password: string;
  onEmail: (v: string) => void;
  onPassword: (v: string) => void;
}) {
  return (
    <>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => onEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />
      </label>
    </>
  );
}
