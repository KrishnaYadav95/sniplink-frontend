import { useState, useEffect, useCallback } from "react";

// This is Create React App (CRA), so environment variables must start with
// REACT_APP_ and are inlined at BUILD time by webpack. The variable name is
// process.env.REACT_APP_*, NOT import.meta.env.VITE_*.
//
// Set REACT_APP_API_URL in Render → your frontend service → Environment,
// then redeploy with the build cache cleared. Changing the variable without
// redeploying does nothing — it's baked into the bundle at build time.
const API = (process.env.REACT_APP_API_URL || "https://sniplink-backend-55vo.onrender.com").replace(/\/$/, "");

const initialAuth = { username: "", password: "" };

const OFFLINE_MSG =
  "Can't reach the server. Free Render instances sleep after inactivity - give it up to a minute and try again.";

// Every backend call goes through here to guarantee:
// 1. credentials: "include" so JSESSIONID crosses from vercel.app to onrender.com
// 2. Thrown errors mean NETWORK failure only, not HTTP errors (401/500 return normally)
// 3. Content-Type is only sent when there's a body
const request = async (path, options = {}) => {
  try {
    return await fetch(`${API}${path}`, {
      credentials: "include",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch (cause) {
    throw new Error("offline", { cause });
  }
};

const isEnterSubmit = (e) =>
  e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229;

export default function App() {
  const [page, setPage] = useState("home");
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [authForm, setAuthForm] = useState(initialAuth);
  const [authError, setAuthError] = useState("");
  const [urls, setUrls] = useState([]);
  const [longUrl, setLongUrl] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [copied, setCopied] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadUrls = useCallback(async () => {
    try {
      const res = await request("/url/allurl");
      if (res.ok) {
        setUrls(await res.json());
        return;
      }
      if (res.status === 401 || res.status === 403) {
        setUser(null);
        setUrls([]);
        setPage("login");
        setAuthError("Your session expired. Please sign in again.");
      }
    } catch {
      showToast(OFFLINE_MSG, "error");
    }
  }, []);

  // Bootstrap: discover existing session or handle OAuth callback
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const params = new URLSearchParams(window.location.search);
      const oauthFailed = params.get("error") === "oauth";

      if (params.has("login") || params.has("error")) {
        window.history.replaceState({}, "", window.location.pathname);
      }

      try {
        const res = await request("/user/me");

        if (cancelled) return;

        if (res.ok) {
          const data = await res.json();
          if (data.authenticated) {
            setUser(data.username);
            setPage("dashboard");
            loadUrls();
            return;
          }
        }

        if (oauthFailed) {
          setPage("login");
          setAuthError("Google/GitHub sign-in was cancelled or failed.");
        }
      } catch {
        if (!cancelled) {
          showToast(OFFLINE_MSG, "error");
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadUrls]);

  const handleRegister = async () => {
    setAuthError("");
    setLoading(true);
    try {
      const res = await request("/user/register", {
        method: "POST",
        body: JSON.stringify(authForm),
      });
      if (res.ok) {
        showToast("Account created! Please log in.");
        setPage("login");
        setAuthForm(initialAuth);
      } else {
        setAuthError("Registration failed. Try a different username.");
      }
    } catch {
      setAuthError(OFFLINE_MSG);
    }
    setLoading(false);
  };

  const handleLogin = async () => {
    setAuthError("");
    setLoading(true);
    try {
      const res = await request("/user/login", {
        method: "POST",
        body: JSON.stringify(authForm),
      });

      if (res.ok) {
        const data = await res.json();
        setUser(data.username || authForm.username);
        setAuthForm(initialAuth);
        setPage("dashboard");
        loadUrls();
      } else if (res.status === 401 || res.status === 403) {
        setAuthError("Wrong username or password.");
      } else {
        setAuthError("Something went wrong signing in. Please try again.");
      }
    } catch {
      setAuthError(OFFLINE_MSG);
    }
    setLoading(false);
  };

  const handleLogout = async () => {
    try {
      await request("/user/logout", { method: "POST" });
    } catch {
      // Clear locally regardless
    }
    setUser(null);
    setUrls([]);
    setResult(null);
    setPage("home");
  };

  const handleShorten = async () => {
    if (!longUrl.trim()) return;
    setLoading(true);
    try {
      const res = await request("/url/short-url", {
        method: "POST",
        body: JSON.stringify({ longurl: longUrl }),
      });
      if (res.ok) {
        setResult(await res.json());
        setLongUrl("");
        loadUrls();
        showToast("Short URL created!");
      } else if (res.status === 401 || res.status === 403) {
        setUser(null);
        setPage("login");
        setAuthError("Your session expired. Please sign in again.");
      } else {
        showToast("Failed to shorten URL.", "error");
      }
    } catch {
      showToast(OFFLINE_MSG, "error");
    }
    setLoading(false);
  };

  const handleDelete = async (id) => {
    try {
      const res = await request(`/url/delete-url/${id}`, { method: "DELETE" });
      if (res.ok) {
        setUrls((prev) => prev.filter((u) => u.id !== id));
        showToast("URL deleted.");
      } else {
        showToast("Delete failed.", "error");
      }
    } catch {
      showToast(OFFLINE_MSG, "error");
    }
  };

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const shortLink = (code) => `${API}/url/original-url/${code}`;
  const oauthUrl = (provider) => `${API}/oauth2/authorization/${provider}`;

  if (booting) {
    return (
      <>
        <FontImport />
        <div style={{ ...styles.root, ...styles.bootWrap }}>
          <div style={styles.bootInner}>
            <span style={styles.logo}>Sniplink</span>
            <p style={styles.bootText}>Connecting…</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <div style={styles.root}>
      <FontImport />
      <div style={styles.grain} />

      {toast && (
        <div
          style={{
            ...styles.toast,
            ...(toast.type === "error" ? styles.toastError : styles.toastSuccess),
          }}
          role="status"
          aria-live="polite"
        >
          {toast.msg}
        </div>
      )}

      <nav style={styles.nav}>
        <span
          style={styles.logo}
          onClick={() => setPage(user ? "dashboard" : "home")}
        >
          Sniplink
        </span>
        <div style={styles.navLinks}>
          {user ? (
            <>
              <span style={styles.navUser}>{user}</span>
              <button style={styles.navBtn} onClick={handleLogout}>
                Log out
              </button>
            </>
          ) : (
            <>
              <button style={styles.navBtn} onClick={() => setPage("login")}>
                Log in
              </button>
              <button
                style={{ ...styles.navBtn, ...styles.navBtnPrimary }}
                onClick={() => setPage("register")}
              >
                Sign up
              </button>
            </>
          )}
        </div>
      </nav>

      {page === "home" && (
        <div style={styles.hero}>
          <div style={styles.heroTag}>A shorter way to point somewhere</div>
          <h1 style={styles.heroTitle}>
            Long links,
            <br />
            <span style={styles.accent}>kept short.</span>
          </h1>
          <p style={styles.heroSub}>
            Paste a URL, get back something worth sharing. No clutter, no
            tracking pixels, just a link that works.
          </p>
          <div style={styles.heroBtns}>
            <button
              style={{ ...styles.btnPrimary, ...styles.btnInline }}
              onClick={() => setPage("register")}
            >
              Create a link
            </button>
            <button style={styles.btnGhost} onClick={() => setPage("login")}>
              I have an account
            </button>
          </div>
          <div style={styles.heroStats}>
            <div style={styles.stat}>
              <span style={styles.statNum}>∞</span>
              <span style={styles.statLabel}>Links</span>
            </div>
            <div style={styles.statDivider} />
            <div style={styles.stat}>
              <span style={styles.statNum}>1ms</span>
              <span style={styles.statLabel}>Redirect</span>
            </div>
            <div style={styles.statDivider} />
            <div style={styles.stat}>
              <span style={styles.statNum}>Free</span>
              <span style={styles.statLabel}>Always</span>
            </div>
          </div>
        </div>
      )}

      {page === "login" && (
        <div style={styles.formWrap}>
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Welcome back</h2>
            <p style={styles.cardSub}>Sign in to your Sniplink account</p>
            <input
              style={styles.input}
              placeholder="Username"
              autoComplete="username"
              value={authForm.username}
              onChange={(e) =>
                setAuthForm({ ...authForm, username: e.target.value })
              }
            />
            <input
              style={styles.input}
              type="password"
              placeholder="Password"
              autoComplete="current-password"
              value={authForm.password}
              onChange={(e) =>
                setAuthForm({ ...authForm, password: e.target.value })
              }
              onKeyDown={(e) => isEnterSubmit(e) && handleLogin()}
            />
            {authError && <div style={styles.error}>{authError}</div>}
            <button
              style={styles.btnPrimary}
              onClick={handleLogin}
              disabled={loading}
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
            <div style={styles.oauthDivider}>
              <span style={styles.oauthDividerLine} />
              <span>or continue with</span>
              <span style={styles.oauthDividerLine} />
            </div>
            <div style={styles.oauthBtns}>
              <a href={oauthUrl("google")} style={styles.oauthBtn}>
                <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Google
              </a>
              <a href={oauthUrl("github")} style={styles.oauthBtn}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                </svg>
                GitHub
              </a>
            </div>
            <p style={styles.switchText}>
              No account?{" "}
              <span style={styles.link} onClick={() => setPage("register")}>
                Sign up
              </span>
            </p>
          </div>
        </div>
      )}

      {page === "register" && (
        <div style={styles.formWrap}>
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Create an account</h2>
            <p style={styles.cardSub}>Join Sniplink — free, always</p>
            <input
              style={styles.input}
              placeholder="Username"
              autoComplete="username"
              value={authForm.username}
              onChange={(e) =>
                setAuthForm({ ...authForm, username: e.target.value })
              }
            />
            <input
              style={styles.input}
              type="password"
              placeholder="Password"
              autoComplete="new-password"
              value={authForm.password}
              onChange={(e) =>
                setAuthForm({ ...authForm, password: e.target.value })
              }
              onKeyDown={(e) => isEnterSubmit(e) && handleRegister()}
            />
            {authError && <div style={styles.error}>{authError}</div>}
            <button
              style={styles.btnPrimary}
              onClick={handleRegister}
              disabled={loading}
            >
              {loading ? "Creating…" : "Create account"}
            </button>
            <p style={styles.switchText}>
              Already have an account?{" "}
              <span style={styles.link} onClick={() => setPage("login")}>
                Sign in
              </span>
            </p>
          </div>
        </div>
      )}

      {page === "dashboard" && user && (
        <div style={styles.dashboard}>
          <div style={styles.dashHeader}>
            <h2 style={styles.dashTitle}>Your links</h2>
            <p style={styles.dashSub}>Shorten, manage, and share</p>
          </div>

          <div style={styles.shortenerBox}>
            <div style={styles.shortenerInner}>
              <input
                style={styles.shortenerInput}
                placeholder="Paste a long URL…"
                value={longUrl}
                onChange={(e) => setLongUrl(e.target.value)}
                onKeyDown={(e) => isEnterSubmit(e) && handleShorten()}
              />
              <button
                style={styles.shortenerBtn}
                onClick={handleShorten}
                disabled={loading}
              >
                {loading ? "…" : "Shorten"}
              </button>
            </div>
          </div>

          {result && (
            <div style={styles.stub}>
              <div style={styles.stubPerf} />
              <div style={styles.stubBody}>
                <span style={styles.stubLabel}>Your short link</span>
                <a
                  href={shortLink(result.shorturl)}
                  target="_blank"
                  rel="noreferrer"
                  style={styles.stubLink}
                >
                  {shortLink(result.shorturl).replace(/^https?:\/\//, "")}
                </a>
              </div>
              <button
                style={styles.stubCopy}
                onClick={() =>
                  copyToClipboard(shortLink(result.shorturl), "result")
                }
              >
                {copied === "result" ? "Copied" : "Copy"}
              </button>
            </div>
          )}

          <div style={styles.urlList}>
            {urls.length === 0 ? (
              <div style={styles.emptyState}>
                <p>No links yet — shorten your first URL above.</p>
              </div>
            ) : (
              urls.map((url) => (
                <div key={url.id} style={styles.urlCard}>
                  <div style={styles.urlCardLeft}>
                    <div style={styles.urlShort}>
                      <a
                        href={shortLink(url.shorturl)}
                        target="_blank"
                        rel="noreferrer"
                        style={styles.urlShortLink}
                      >
                        sniplink/{url.shorturl}
                      </a>
                      <button
                        style={styles.copySmall}
                        onClick={() =>
                          copyToClipboard(shortLink(url.shorturl), url.id)
                        }
                      >
                        {copied === url.id ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <div style={styles.urlLong}>{url.longurl}</div>
                  </div>
                  <button
                    style={styles.deleteBtn}
                    onClick={() => handleDelete(url.id)}
                    aria-label={`Delete short link for ${url.longurl}`}
                  >
                    Delete
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Loads the two type families the design relies on. Kept as a component so
// it's declared once, inline, without touching index.html.
function FontImport() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600;700&display=swap');
    `}</style>
  );
}

// ---- Design tokens ----------------------------------------------------
// Ink charcoal ground, warm paper text, copper as the one accent that's
// allowed to be loud, dusty teal held in reserve for anything secondary.
// No purple, no glow, no gradients that read as "AI app default."
const color = {
  bg: "#15161c",
  bgRaised: "#1b1c23",
  bgCard: "#1e1f27",
  border: "rgba(240, 236, 227, 0.09)",
  borderStrong: "rgba(240, 236, 227, 0.16)",
  text: "#f0ece3",
  textMuted: "#9a9690",
  textFaint: "#65625d",
  copper: "#c9905a",
  copperBright: "#dba672",
  teal: "#5b8b83",
  errorBg: "rgba(196, 90, 74, 0.12)",
  errorBorder: "rgba(196, 90, 74, 0.35)",
  errorText: "#d3745f",
};

const serif = "'Fraunces', Georgia, serif";
const sans = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

const styles = {
  root: {
    minHeight: "100vh",
    background: color.bg,
    color: color.text,
    fontFamily: sans,
    position: "relative",
  },
  bootWrap: { display: "flex", alignItems: "center", justifyContent: "center" },
  bootInner: { display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" },
  bootText: { color: color.textFaint, fontSize: "14px", margin: 0 },

  // Subtle paper grain instead of glowing blobs
  grain: {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    zIndex: 0,
    backgroundImage:
      "radial-gradient(rgba(240,236,227,0.025) 1px, transparent 1px)",
    backgroundSize: "3px 3px",
  },

  toast: {
    position: "fixed",
    top: "78px",
    right: "24px",
    padding: "12px 22px",
    borderRadius: "10px",
    fontWeight: 600,
    fontSize: "14px",
    zIndex: 1000,
    maxWidth: "340px",
    lineHeight: 1.5,
    border: `1px solid ${color.borderStrong}`,
    boxShadow: "0 12px 28px rgba(0,0,0,0.35)",
  },
  toastSuccess: { background: color.bgCard, color: color.teal, borderColor: "rgba(91,139,131,0.35)" },
  toastError: { background: color.bgCard, color: color.errorText, borderColor: color.errorBorder },

  nav: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "22px 40px",
    position: "relative",
    zIndex: 10,
    borderBottom: `1px solid ${color.border}`,
  },
  logo: {
    fontFamily: serif,
    fontSize: "22px",
    fontWeight: 600,
    cursor: "pointer",
    color: color.copperBright,
    letterSpacing: "-0.3px",
  },
  navLinks: { display: "flex", alignItems: "center", gap: "10px" },
  navUser: { fontSize: "14px", color: color.textMuted, marginRight: "6px", fontFamily: sans },
  navBtn: {
    padding: "9px 18px",
    borderRadius: "8px",
    border: `1px solid ${color.borderStrong}`,
    background: "transparent",
    color: color.text,
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 500,
    fontFamily: sans,
  },
  navBtnPrimary: {
    background: color.copper,
    border: `1px solid ${color.copper}`,
    color: "#1a1408",
    fontWeight: 600,
  },

  hero: {
    textAlign: "center",
    padding: "110px 24px 64px",
    position: "relative",
    zIndex: 1,
  },
  heroTag: {
    display: "inline-block",
    padding: "6px 16px",
    background: color.bgRaised,
    border: `1px solid ${color.border}`,
    borderRadius: "100px",
    fontSize: "13px",
    color: color.teal,
    marginBottom: "28px",
    letterSpacing: "0.3px",
    fontFamily: sans,
  },
  heroTitle: {
    fontFamily: serif,
    fontSize: "clamp(42px, 7vw, 78px)",
    fontWeight: 500,
    lineHeight: 1.08,
    margin: "0 0 24px",
    letterSpacing: "-1.5px",
    color: color.text,
  },
  accent: { color: color.copperBright, fontStyle: "italic" },
  heroSub: {
    fontSize: "17px",
    color: color.textMuted,
    maxWidth: "460px",
    margin: "0 auto 40px",
    lineHeight: 1.65,
    fontFamily: sans,
  },
  heroBtns: { display: "flex", gap: "14px", justifyContent: "center", flexWrap: "wrap" },
  btnPrimary: {
    padding: "14px 30px",
    borderRadius: "10px",
    border: "none",
    background: color.copper,
    color: "#1a1408",
    cursor: "pointer",
    fontSize: "15px",
    fontWeight: 600,
    letterSpacing: "-0.1px",
    width: "100%",
    marginTop: "6px",
    fontFamily: sans,
  },
  btnInline: { width: "auto", marginTop: 0 },
  btnGhost: {
    padding: "14px 30px",
    borderRadius: "10px",
    border: `1px solid ${color.borderStrong}`,
    background: "transparent",
    color: color.textMuted,
    cursor: "pointer",
    fontSize: "15px",
    fontWeight: 500,
    fontFamily: sans,
  },
  heroStats: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: "32px",
    marginTop: "68px",
  },
  stat: { display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" },
  statNum: { fontFamily: serif, fontSize: "26px", fontWeight: 600, color: color.text },
  statLabel: {
    fontSize: "11px",
    color: color.textFaint,
    textTransform: "uppercase",
    letterSpacing: "1.2px",
    fontFamily: sans,
  },
  statDivider: { width: "1px", height: "36px", background: color.border },

  formWrap: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    minHeight: "calc(100vh - 82px)",
    padding: "24px",
    position: "relative",
    zIndex: 1,
  },
  card: {
    background: color.bgRaised,
    border: `1px solid ${color.border}`,
    borderRadius: "16px",
    padding: "40px",
    width: "100%",
    maxWidth: "400px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  cardTitle: {
    fontFamily: serif,
    fontSize: "26px",
    fontWeight: 600,
    textAlign: "center",
    margin: 0,
    color: color.text,
  },
  cardSub: {
    fontSize: "14px",
    color: color.textFaint,
    textAlign: "center",
    margin: "0 0 8px",
    fontFamily: sans,
  },
  input: {
    padding: "13px 16px",
    borderRadius: "9px",
    border: `1px solid ${color.border}`,
    background: color.bg,
    color: color.text,
    fontSize: "15px",
    outline: "none",
    fontFamily: sans,
  },
  error: {
    background: color.errorBg,
    border: `1px solid ${color.errorBorder}`,
    borderRadius: "8px",
    padding: "10px 14px",
    color: color.errorText,
    fontSize: "14px",
    lineHeight: 1.5,
    fontFamily: sans,
  },
  oauthDivider: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    color: color.textFaint,
    fontSize: "12.5px",
    fontFamily: sans,
  },
  oauthDividerLine: { flex: 1, height: "1px", background: color.border },
  oauthBtns: { display: "flex", gap: "10px" },
  oauthBtn: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    padding: "11px",
    borderRadius: "9px",
    border: `1px solid ${color.border}`,
    background: color.bg,
    color: color.textMuted,
    fontSize: "13.5px",
    fontWeight: 500,
    textDecoration: "none",
    fontFamily: sans,
  },
  switchText: { textAlign: "center", fontSize: "14px", color: color.textFaint, margin: 0, fontFamily: sans },
  link: { color: color.copperBright, cursor: "pointer", fontWeight: 600 },

  dashboard: { maxWidth: "740px", margin: "0 auto", padding: "44px 24px", position: "relative", zIndex: 1 },
  dashHeader: { marginBottom: "30px" },
  dashTitle: { fontFamily: serif, fontSize: "30px", fontWeight: 600, margin: "0 0 6px", color: color.text },
  dashSub: { fontSize: "14.5px", color: color.textFaint, margin: 0, fontFamily: sans },

  shortenerBox: {
    background: color.bgRaised,
    border: `1px solid ${color.border}`,
    borderRadius: "14px",
    padding: "20px",
    marginBottom: "24px",
  },
  shortenerInner: { display: "flex", gap: "10px" },
  shortenerInput: {
    flex: 1,
    minWidth: 0,
    padding: "13px 16px",
    borderRadius: "9px",
    border: `1px solid ${color.border}`,
    background: color.bg,
    color: color.text,
    fontSize: "15px",
    outline: "none",
    fontFamily: sans,
  },
  shortenerBtn: {
    padding: "13px 22px",
    borderRadius: "9px",
    border: "none",
    background: color.copper,
    color: "#1a1408",
    cursor: "pointer",
    fontSize: "14.5px",
    fontWeight: 600,
    whiteSpace: "nowrap",
    fontFamily: sans,
  },

  // The signature element: the fresh short link renders like a torn ticket
  // stub — a perforated line separates the label from the copy action,
  // because getting your link back is the one moment this app is for.
  stub: {
    display: "flex",
    alignItems: "stretch",
    background: color.bgCard,
    border: `1px solid ${color.border}`,
    borderRadius: "12px",
    marginBottom: "24px",
    overflow: "hidden",
  },
  stubPerf: {
    width: "14px",
    flexShrink: 0,
    backgroundImage: `radial-gradient(circle, ${color.bg} 3px, transparent 3.5px)`,
    backgroundSize: "14px 14px",
    backgroundPosition: "center",
    borderRight: `1px dashed ${color.borderStrong}`,
  },
  stubBody: { flex: 1, minWidth: 0, padding: "16px 18px", display: "flex", flexDirection: "column", gap: "3px" },
  stubLabel: {
    fontSize: "11px",
    color: color.teal,
    textTransform: "uppercase",
    letterSpacing: "1px",
    fontFamily: sans,
    fontWeight: 600,
  },
  stubLink: {
    fontFamily: serif,
    color: color.copperBright,
    fontSize: "17px",
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  stubCopy: {
    border: "none",
    background: "transparent",
    color: color.textMuted,
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 600,
    padding: "0 20px",
    borderLeft: `1px solid ${color.border}`,
    fontFamily: sans,
  },

  urlList: { display: "flex", flexDirection: "column", gap: "10px" },
  emptyState: { textAlign: "center", padding: "56px 24px", color: color.textFaint, fontSize: "14.5px", fontFamily: sans },
  urlCard: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: color.bgRaised,
    border: `1px solid ${color.border}`,
    borderRadius: "12px",
    padding: "15px 18px",
  },
  urlCardLeft: { flex: 1, minWidth: 0 },
  urlShort: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "5px" },
  urlShortLink: { fontFamily: serif, color: color.copperBright, fontWeight: 500, fontSize: "15.5px", textDecoration: "none" },
  copySmall: {
    padding: "2px 9px",
    borderRadius: "6px",
    border: `1px solid ${color.border}`,
    background: "transparent",
    color: color.teal,
    cursor: "pointer",
    fontSize: "11.5px",
    fontWeight: 600,
    fontFamily: sans,
  },
  urlLong: {
    color: color.textFaint,
    fontSize: "13px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "480px",
    fontFamily: sans,
  },
  deleteBtn: {
    background: "transparent",
    border: `1px solid ${color.border}`,
    borderRadius: "8px",
    padding: "9px 13px",
    cursor: "pointer",
    fontSize: "12.5px",
    fontWeight: 600,
    color: color.errorText,
    marginLeft: "16px",
    fontFamily: sans,
  },
};