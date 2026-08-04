import { useState, useEffect, useCallback } from "react";

// This is Create React App (CRA), so environment variables must start with
// REACT_APP_ and are inlined at BUILD time by webpack. The variable name is
// process.env.REACT_APP_*, NOT import.meta.env.VITE_*.
//
// Set REACT_APP_API_URL in Render → your frontend service → Environment,
// then redeploy with the build cache cleared. Changing the variable without
// redeploying does nothing — it's baked into the bundle at build time.
const API = (process.env.REACT_APP_API_URL || "https://sniplink-backend-55vo.onrender.com").replace(/\/$/, "");

const TOKEN_KEY = "sniplink_token";

const initialAuth = { username: "", password: "" };

const OFFLINE_MSG =
  "Can't reach the server. Free Render instances sleep after inactivity - give it up to a minute and try again.";

// Every backend call goes through here to guarantee:
// 1. Authorization: Bearer <jwt> is attached when we have a token
//    (credentials: "include" is kept only so OAuth2 login, which is
//    session-cookie based, keeps working — the two auth modes coexist)
// 2. Thrown errors mean NETWORK failure only, not HTTP errors (401/500 return normally)
// 3. Content-Type is only sent when there's a body
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const request = async (path, options = {}) => {
  const token = localStorage.getItem(TOKEN_KEY);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${API}${path}`, {
        credentials: "include",
        ...options,
        headers: {
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers,
        },
      });

      return response;
    } catch (cause) {
      // First network failure: Render is probably waking up.
      if (attempt === 0) {
        await sleep(5000);
        continue;
      }

      throw new Error("offline", { cause });
    }
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
        localStorage.removeItem(TOKEN_KEY);
        setUser(null);
        setUrls([]);
        setPage("login");
        setAuthError("Your session expired. Please sign in again.");
      }
    } catch {
      showToast(OFFLINE_MSG, "error");
    }
  }, []);

  // Bootstrap: discover existing session (JWT in localStorage, or OAuth2 session cookie)
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
        } else if (res.status === 401 || res.status === 403) {
          // stale/invalid token left over from a previous session
          localStorage.removeItem(TOKEN_KEY);
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
      if (data.token) {
        localStorage.setItem(TOKEN_KEY, data.token);
      }
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
    localStorage.removeItem(TOKEN_KEY);
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
        localStorage.removeItem(TOKEN_KEY);
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
      <div style={{ ...styles.root, ...styles.bootWrap }}>
        <div style={styles.bootInner}>
          <span style={styles.logo}>Sniplink</span>
          <p style={styles.bootText}>Connecting...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.root}>
      <div style={styles.blob1} />
      <div style={styles.blob2} />
      <div style={styles.blob3} />

      {toast && (
        <div
          style={{
            ...styles.toast,
            background: toast.type === "error" ? "#ff4d6d" : "#06d6a0",
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
                Logout
              </button>
            </>
          ) : (
            <>
              <button style={styles.navBtn} onClick={() => setPage("login")}>
                Login
              </button>
              <button
                style={{ ...styles.navBtn, ...styles.navBtnPrimary }}
                onClick={() => setPage("register")}
              >
                Sign Up
              </button>
            </>
          )}
        </div>
      </nav>

      {page === "home" && (
        <div style={styles.hero}>
          <div style={styles.heroTag}>Fast · Free · Permanent</div>
          <h1 style={styles.heroTitle}>
            Long URLs are <span style={styles.accent}>ugly.</span>
            <br />
            Make them beautiful.
          </h1>
          <p style={styles.heroSub}>
            Sniplink turns any URL into a clean, shareable short link in one
            click.
          </p>
          <div style={styles.heroBtns}>
            <button
              style={{ ...styles.btnPrimary, ...styles.btnInline }}
              onClick={() => setPage("register")}
            >
              Get Started Free
            </button>
            <button style={styles.btnGhost} onClick={() => setPage("login")}>
              I have an account
            </button>
          </div>
          <div style={styles.heroStats}>
            <div style={styles.stat}>
              <span style={styles.statNum}>∞</span>
              <span style={styles.statLabel}>URLs</span>
            </div>
            <div style={styles.statDivider} />
            <div style={styles.stat}>
              <span style={styles.statNum}>1ms</span>
              <span style={styles.statLabel}>Redirect</span>
            </div>
            <div style={styles.statDivider} />
            <div style={styles.stat}>
              <span style={styles.statNum}>100%</span>
              <span style={styles.statLabel}>Free</span>
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
              {loading ? "Signing in..." : "Sign In"}
            </button>
            <div style={styles.oauthDivider}>
              <span style={styles.oauthDividerLine} />
              <span>or continue with</span>
              <span style={styles.oauthDividerLine} />
            </div>
            <div style={styles.oauthBtns}>
              <a href={oauthUrl("google")} style={styles.oauthBtn}>
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Google
              </a>
              <a href={oauthUrl("github")} style={styles.oauthBtn}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
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
            <h2 style={styles.cardTitle}>Create account</h2>
            <p style={styles.cardSub}>Join Sniplink — it&apos;s free forever</p>
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
              {loading ? "Creating..." : "Create Account"}
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
            <h2 style={styles.dashTitle}>Your Links</h2>
            <p style={styles.dashSub}>Shorten, manage, and share your URLs</p>
          </div>

          <div style={styles.shortenerBox}>
            <div style={styles.shortenerInner}>
              <input
                style={styles.shortenerInput}
                placeholder="Paste your long URL here..."
                value={longUrl}
                onChange={(e) => setLongUrl(e.target.value)}
                onKeyDown={(e) => isEnterSubmit(e) && handleShorten()}
              />
              <button
                style={styles.shortenerBtn}
                onClick={handleShorten}
                disabled={loading}
              >
                {loading ? "..." : "Shorten"}
              </button>
            </div>
          </div>

          {result && (
            <div style={styles.resultBox}>
              <span style={styles.resultLabel}>Your short link:</span>
              <a
                href={shortLink(result.shorturl)}
                target="_blank"
                rel="noreferrer"
                style={styles.resultLink}
              >
                {shortLink(result.shorturl)}
              </a>
              <button
                style={styles.copyBtn}
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
                <p>No links yet. Shorten your first URL above.</p>
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

const styles = {
  root: {
    minHeight: "100vh",
    background: "#0a0a0f",
    color: "#e8e8f0",
    fontFamily: "'Inter', -apple-system, sans-serif",
    position: "relative",
    overflow: "hidden",
  },
  bootWrap: { display: "flex", alignItems: "center", justifyContent: "center" },
  bootInner: { display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" },
  bootText: { color: "#6060a0", fontSize: "14px", margin: 0 },
  blob1: {
    position: "fixed",
    top: "-200px",
    left: "-200px",
    width: "600px",
    height: "600px",
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)",
    pointerEvents: "none",
    zIndex: 0,
  },
  blob2: {
    position: "fixed",
    bottom: "-150px",
    right: "-150px",
    width: "500px",
    height: "500px",
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(168,85,247,0.12) 0%, transparent 70%)",
    pointerEvents: "none",
    zIndex: 0,
  },
  blob3: {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%,-50%)",
    width: "800px",
    height: "400px",
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(6,214,160,0.04) 0%, transparent 70%)",
    pointerEvents: "none",
    zIndex: 0,
  },
  toast: {
    position: "fixed",
    top: "80px",
    right: "24px",
    padding: "12px 24px",
    borderRadius: "12px",
    color: "#fff",
    fontWeight: 600,
    fontSize: "14px",
    zIndex: 1000,
    maxWidth: "340px",
    lineHeight: 1.5,
    boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
  },
  nav: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "20px 40px",
    position: "relative",
    zIndex: 10,
    borderBottom: "1px solid rgba(255,255,255,0.06)",
  },
  logo: {
    fontSize: "22px",
    fontWeight: 800,
    cursor: "pointer",
    background: "linear-gradient(135deg, #818cf8, #c084fc)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    letterSpacing: "-0.5px",
  },
  navLinks: { display: "flex", alignItems: "center", gap: "12px" },
  navUser: { fontSize: "14px", color: "#a0a0b8", marginRight: "8px" },
  navBtn: {
    padding: "8px 18px",
    borderRadius: "10px",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "transparent",
    color: "#e8e8f0",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 500,
    transition: "all 0.2s",
  },
  navBtnPrimary: {
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    border: "none",
    color: "#fff",
  },
  hero: {
    textAlign: "center",
    padding: "100px 24px 60px",
    position: "relative",
    zIndex: 1,
  },
  heroTag: {
    display: "inline-block",
    padding: "6px 16px",
    background: "rgba(99,102,241,0.15)",
    border: "1px solid rgba(99,102,241,0.3)",
    borderRadius: "100px",
    fontSize: "13px",
    color: "#818cf8",
    marginBottom: "24px",
    letterSpacing: "0.5px",
  },
  heroTitle: {
    fontSize: "clamp(40px, 7vw, 76px)",
    fontWeight: 900,
    lineHeight: 1.1,
    margin: "0 0 24px",
    letterSpacing: "-2px",
    color: "#f0f0ff",
  },
  accent: {
    background: "linear-gradient(135deg, #818cf8, #c084fc)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },
  heroSub: {
    fontSize: "18px",
    color: "#7070a0",
    maxWidth: "480px",
    margin: "0 auto 40px",
    lineHeight: 1.6,
  },
  heroBtns: { display: "flex", gap: "16px", justifyContent: "center", flexWrap: "wrap" },
  btnPrimary: {
    padding: "14px 32px",
    borderRadius: "14px",
    border: "none",
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    color: "#fff",
    cursor: "pointer",
    fontSize: "16px",
    fontWeight: 700,
    letterSpacing: "-0.3px",
    width: "100%",
    marginTop: "8px",
    boxShadow: "0 8px 32px rgba(99,102,241,0.35)",
    transition: "transform 0.15s, box-shadow 0.15s",
  },
  btnInline: { width: "auto", marginTop: 0 },
  btnGhost: {
    padding: "14px 32px",
    borderRadius: "14px",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "transparent",
    color: "#a0a0c0",
    cursor: "pointer",
    fontSize: "16px",
    fontWeight: 600,
  },
  heroStats: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: "32px",
    marginTop: "64px",
  },
  stat: { display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" },
  statNum: { fontSize: "28px", fontWeight: 800, color: "#f0f0ff" },
  statLabel: {
    fontSize: "12px",
    color: "#6060a0",
    textTransform: "uppercase",
    letterSpacing: "1px",
  },
  statDivider: {
    width: "1px",
    height: "40px",
    background: "rgba(255,255,255,0.08)",
  },
  formWrap: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    minHeight: "calc(100vh - 80px)",
    padding: "24px",
    position: "relative",
    zIndex: 1,
  },
  card: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "24px",
    padding: "40px",
    width: "100%",
    maxWidth: "400px",
    backdropFilter: "blur(20px)",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  cardTitle: {
    fontSize: "26px",
    fontWeight: 800,
    textAlign: "center",
    margin: 0,
    color: "#f0f0ff",
  },
  cardSub: {
    fontSize: "14px",
    color: "#7070a0",
    textAlign: "center",
    margin: "0 0 8px",
  },
  input: {
    padding: "14px 16px",
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.05)",
    color: "#e8e8f0",
    fontSize: "15px",
    outline: "none",
    transition: "border 0.2s",
  },
  error: {
    background: "rgba(255,77,109,0.12)",
    border: "1px solid rgba(255,77,109,0.3)",
    borderRadius: "10px",
    padding: "10px 14px",
    color: "#ff4d6d",
    fontSize: "14px",
    lineHeight: 1.5,
  },
  oauthDivider: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    color: "#5050a0",
    fontSize: "13px",
  },
  oauthDividerLine: {
    flex: 1,
    height: "1px",
    background: "rgba(255,255,255,0.08)",
  },
  oauthBtns: { display: "flex", gap: "12px" },
  oauthBtn: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    padding: "12px",
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.04)",
    color: "#c0c0e0",
    fontSize: "14px",
    fontWeight: 600,
    textDecoration: "none",
    transition: "background 0.2s",
  },
  switchText: {
    textAlign: "center",
    fontSize: "14px",
    color: "#6060a0",
    margin: 0,
  },
  link: { color: "#818cf8", cursor: "pointer", fontWeight: 600 },
  dashboard: {
    maxWidth: "760px",
    margin: "0 auto",
    padding: "40px 24px",
    position: "relative",
    zIndex: 1,
  },
  dashHeader: { marginBottom: "32px" },
  dashTitle: {
    fontSize: "32px",
    fontWeight: 800,
    margin: "0 0 8px",
    color: "#f0f0ff",
  },
  dashSub: { fontSize: "15px", color: "#6060a0", margin: 0 },
  shortenerBox: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "20px",
    padding: "24px",
    marginBottom: "24px",
  },
  shortenerInner: { display: "flex", gap: "12px" },
  shortenerInput: {
    flex: 1,
    minWidth: 0,
    padding: "14px 18px",
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.05)",
    color: "#e8e8f0",
    fontSize: "15px",
    outline: "none",
  },
  shortenerBtn: {
    padding: "14px 24px",
    borderRadius: "12px",
    border: "none",
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    color: "#fff",
    cursor: "pointer",
    fontSize: "15px",
    fontWeight: 700,
    whiteSpace: "nowrap",
    boxShadow: "0 4px 20px rgba(99,102,241,0.4)",
  },
  resultBox: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
    background: "rgba(6,214,160,0.08)",
    border: "1px solid rgba(6,214,160,0.2)",
    borderRadius: "14px",
    padding: "16px 20px",
    marginBottom: "24px",
  },
  resultLabel: { fontSize: "13px", color: "#06d6a0", fontWeight: 600 },
  resultLink: { color: "#06d6a0", fontWeight: 700, fontSize: "15px" },
  copyBtn: {
    padding: "6px 14px",
    borderRadius: "8px",
    border: "none",
    background: "rgba(6,214,160,0.2)",
    color: "#06d6a0",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 600,
    marginLeft: "auto",
  },
  urlList: { display: "flex", flexDirection: "column", gap: "12px" },
  emptyState: {
    textAlign: "center",
    padding: "60px 24px",
    color: "#5050a0",
    fontSize: "15px",
  },
  urlCard: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: "16px",
    padding: "16px 20px",
    transition: "border-color 0.2s",
  },
  urlCardLeft: { flex: 1, minWidth: 0 },
  urlShort: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "6px",
  },
  urlShortLink: {
    color: "#818cf8",
    fontWeight: 700,
    fontSize: "15px",
    textDecoration: "none",
  },
  copySmall: {
    padding: "3px 10px",
    borderRadius: "6px",
    border: "none",
    background: "rgba(129,140,248,0.15)",
    color: "#818cf8",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 600,
  },
  urlLong: {
    color: "#5050a0",
    fontSize: "13px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "500px",
  },
  deleteBtn: {
    background: "rgba(255,77,109,0.1)",
    border: "none",
    borderRadius: "10px",
    padding: "10px 14px",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 600,
    color: "#ff4d6d",
    marginLeft: "16px",
    transition: "background 0.2s",
  },
};