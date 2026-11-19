/// <reference types="vite/client" />
import "./style.css";
import { publishedRenderUrl, waitForAudioService } from "./cloud";
import { element } from "./dom";
import { locale, setLocale, t } from "./i18n";
import { isLocalApp } from "./youtube";

interface GoogleIdentity {
  initialize(options: {
    client_id: string;
    callback: (result: { credential?: string }) => void;
    use_fedcm_for_button: boolean;
  }): void;
  renderButton(
    target: HTMLElement,
    options: {
      type: "standard";
      theme: "outline";
      size: "large";
      locale: string;
    },
  ): void;
  disableAutoSelect(): void;
}

const clientId = (
  import.meta.env.VITE_INTONAVIO_GOOGLE_CLIENT_ID ??
  (publishedRenderUrl
    ? "403786780252-gd53230p4hisf9t8bvhc8hv1vn7lqaut.apps.googleusercontent.com"
    : "")
).trim();
const authUrl = (import.meta.env.VITE_INTONAVIO_AUTH_URL ?? publishedRenderUrl)
  .trim()
  .replace(/\/+$/, "");
const sessionKey = "intonavio-google-entry";
const gate = element("google-entry");
const app = element("practice-app");
const signOut = element<HTMLButtonElement>("google-sign-out");
const status = element("google-status");

async function openPractice(signedIn: boolean): Promise<void> {
  gate.hidden = true;
  app.hidden = false;
  signOut.hidden = !signedIn;
  await import("./main");
}

function googleScript(): Promise<GoogleIdentity> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      const identity = (
        window as Window & {
          google?: { accounts?: { id?: GoogleIdentity } };
        }
      ).google?.accounts?.id;
      if (identity) resolve(identity);
      else reject(new Error("Google Identity Services did not initialize."));
    };
    script.onerror = () =>
      reject(new Error("Google Identity Services did not load."));
    document.head.append(script);
  });
}

async function verify(url: string, token: string): Promise<boolean> {
  status.textContent = t("googleChecking");
  const signal = AbortSignal.timeout(145000);
  if (!(await waitForAudioService(url, signal)))
    throw new Error("Authentication service did not start.");
  const response = await fetch(url + "/api/auth/google", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    cache: "no-store",
    redirect: "error",
    signal,
  });
  if (response.status === 401) return false;
  if (!response.ok || (await response.json()).signedIn !== true)
    throw new Error("Authentication service is unavailable.");
  return true;
}

async function start(): Promise<void> {
  if (!clientId || isLocalApp) return openPractice(false);
  setLocale(locale);
  gate.hidden = false;
  if (!authUrl) {
    status.textContent = t("googleUnavailable");
    return;
  }

  signOut.onclick = () => {
    sessionStorage.removeItem(sessionKey);
    location.reload();
  };
  const remembered = sessionStorage.getItem(sessionKey);
  if (remembered) {
    try {
      if (await verify(authUrl, remembered)) return openPractice(true);
      sessionStorage.removeItem(sessionKey);
    } catch {
      status.textContent = t("googleUnavailable");
    }
  }

  let busy = false;
  const identity = await googleScript();
  identity.initialize({
    client_id: clientId,
    use_fedcm_for_button: true,
    callback: async ({ credential }) => {
      if (!credential || busy) return;
      busy = true;
      try {
        if (await verify(authUrl, credential)) {
          sessionStorage.setItem(sessionKey, credential);
          signOut.onclick = () => {
            identity.disableAutoSelect();
            sessionStorage.removeItem(sessionKey);
            location.reload();
          };
          await openPractice(true);
        } else {
          status.textContent = t("googleRejected");
        }
      } catch {
        status.textContent = t("googleUnavailable");
      } finally {
        busy = false;
      }
    },
  });
  identity.renderButton(element("google-button"), {
    type: "standard",
    theme: "outline",
    size: "large",
    locale,
  });
  if (!remembered) status.textContent = "";
}

void start().catch(() => {
  gate.hidden = false;
  status.textContent = t("googleUnavailable");
});
