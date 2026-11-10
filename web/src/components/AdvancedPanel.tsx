import { useEffect, useState } from "react";
import { restartApi, type PortInfo, type ProviderStatus } from "../api";
import { Icon } from "../icons";
import { useToast } from "../ui";

interface Props {
  port: PortInfo;
  providers: ProviderStatus[];
  saveSetting: (patch: { port: number }) => Promise<boolean>;
}

export function AdvancedPanel({ port, providers, saveSetting }: Props) {
  const toast = useToast();
  const [value, setValue] = useState(String(port.configured));
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(String(port.configured)), [port.configured]);

  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 1024 && n <= 65535;
  const dirty = n !== port.configured;
  const usesOAuth = providers.some((p) => p.configured || p.connected);

  async function save() {
    if (!valid) return;
    setBusy(true);
    await saveSetting({ port: n });
    setBusy(false);
  }

  async function restart() {
    setBusy(true);
    try {
      await restartApi();
      toast(`Restarting on port ${port.configured}…`, "info");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't restart", "error");
      setBusy(false);
    }
  }

  return (
    <div className="defaults">
      <section>
        <h3>Server port</h3>
        <p className="muted">
          The local port the app's server listens on. Change it if another program already uses port 8000. The server is only
          reachable from this computer.
        </p>
        <div className="row">
          <label className="field port-field">
            <span className="field-box">
              <Icon name="bolt" />
              <input
                inputMode="numeric"
                value={value}
                onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 5))}
                onKeyDown={(e) => e.key === "Enter" && dirty && valid && void save()}
                aria-label="Server port"
                aria-invalid={!valid}
                spellCheck={false}
              />
            </span>
          </label>
          <button type="button" className="btn primary" onClick={save} disabled={!dirty || !valid || busy}>
            Save port
          </button>
        </div>
        {!valid && <p className="fineprint bad">Use a number between 1024 and 65535.</p>}
        <p className="fineprint">
          Running on <b>{port.running}</b>
          {port.restart_needed && (
            <>
              {" "}
              · saved <b>{port.configured}</b> (applies after a restart)
            </>
          )}
        </p>

        {port.restart_needed && (
          <div className="notice warn">
            <Icon name="refresh" />
            <span>
              {port.can_restart ? (
                <>The new port takes effect when the server restarts. Running downloads must finish first.</>
              ) : (
                <>
                  Restart the server yourself to use the new port:{" "}
                  <code>python3 -m uvicorn main:app --port {port.configured}</code>
                </>
              )}
            </span>
            {port.can_restart && (
              <button type="button" className="btn primary small" onClick={restart} disabled={busy}>
                Restart now
              </button>
            )}
          </div>
        )}

        {usesOAuth && (
          <div className="notice info">
            <Icon name="sparkle" />
            <span>
              Dropbox and Google sign-in use the address <code>{port.redirect_uri}</code>. If you change the port, add that
              address as a Redirect URI in your Dropbox or Google app before reconnecting. Existing connections keep working.
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
