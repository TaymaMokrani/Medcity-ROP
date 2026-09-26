import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Input from "@/components/Input";
import NoiseOverlay from "@/components/landing/NoiseOverlay";
import Logo from "@/components/Logo";
import { useAuth } from "@/hooks/auth-context";
import { apiPost, ApiError, errorMessage } from "@/lib/api";
import { useTitle } from "@/hooks/useTitle";

export default function Auth() {
  const navigate = useNavigate();
  const { signIn } = useAuth();

  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useTitle(isLogin ? "Sign in" : "Create an account");

  function switchMode() {
    setIsLogin(!isLogin);
    setError("");
  }

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    if (!email || !password) {
      setError("Please fill in email and password");
      return;
    }
    if (!isLogin && !name) {
      setError("Please enter your name");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const path = isLogin ? "/auth/login" : "/auth/register";
      const body = isLogin ? { email, password } : { name, email, password };

      const { token } = await apiPost<{ token: string }>(path, body);
      signIn(token);
      navigate("/app", { replace: true });
    } catch (e) {
      setError(authError(e));
      setBusy(false);
    }
  }

  return (
    <div className="app-scope theme-dark relative flex min-h-svh w-full bg-bg font-body text-ink">
      <NoiseOverlay />

      <div className="relative m-3 hidden w-[60%] overflow-hidden rounded-[1.75rem] border border-white/10 bg-bg lg:block">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 h-full w-full object-cover object-center"
          src="/eye_animation2.mp4"
        />
      </div>

      <div className="relative flex w-full flex-col items-center justify-center overflow-hidden px-6 py-16 lg:w-[40%]">
        <img
          src="/blue_bg_effect.png"
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-25 mix-blend-screen"
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 78% 62% at 50% 46%, transparent 26%, rgba(5,7,12,0.88) 100%)",
          }}
        />

        <a href="/" className="relative z-10 mb-8 flex items-center lg:hidden">
          <Logo className="h-10" />
        </a>

        <motion.div
          key={isLogin ? "login" : "register"}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative z-10 w-full max-w-md overflow-hidden rounded-[28px] border border-white/12 bg-white/[0.05] p-8 shadow-[0_24px_70px_-24px_rgba(0,0,0,0.7)] backdrop-blur-2xl"
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.07] to-transparent" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent/[0.09] via-transparent to-transparent" />

          <div className="relative z-10">
            <p className="text-label font-semibold uppercase tracking-[0.2em] text-accent">
              {isLogin ? "Welcome back" : "Get started"}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-ink">
              {isLogin ? "Sign in to MedCity" : "Create your account"}
            </h1>
            <p className="mt-2 text-body leading-relaxed text-ink-3">
              {isLogin
                ? "Pick up where you left off with your patients."
                : "Set up your MedCity workspace."}
            </p>

            {error && (
              <div className="mt-4 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-label font-medium text-rose-400">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="mt-7 flex flex-col gap-6">
                <Input
                  dark
                  required
                  type="email"
                  label="Email"
                  value={email}
                  autoComplete="username"
                  onChange={setEmail}
                />
                {!isLogin && (
                  <Input
                    dark
                    required
                    type="username"
                    label="Your name"
                    value={name}
                    autoComplete="name"
                    onChange={setName}
                  />
                )}
                <Input
                  dark
                  required
                  type="password"
                  label="Password"
                  value={password}
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  passwordStrength={!isLogin}
                  onChange={setPassword}
                />
              </div>

            <button
              type="submit"
              disabled={busy}
              className="group mt-7 flex h-11 w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.08] text-body font-semibold text-ink backdrop-blur-md transition-all duration-300 hover:border-accent/50 hover:bg-white/[0.14] cursor-pointer disabled:opacity-50"
            >
              {busy ? "Please wait…" : "Continue"}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </button>
            </form>

            <p className="mt-6 text-center text-body text-ink-3">
              {isLogin ? "New to MedCity? " : "Already have an account? "}
              <span
                onClick={switchMode}
                className="cursor-pointer font-medium text-accent hover:underline"
              >
                {isLogin ? "Create an account" : "Sign in"}
              </span>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function authError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "Incorrect email or password. Check your credentials and try again.";
    }
    if (error.status === 409) {
      return "An account with this email already exists. Sign in instead.";
    }
  }
  return errorMessage(error, "Something went wrong. Please try again.");
}
