"use client";

import type { ImportResult } from "@shared/types";
import { ArrowLeft, ChevronRight, ClipboardPaste, FileUp, Globe2, KeyRound, Link2, Loader2, Network, PencilLine, ShieldHalf } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { cleanError, useVpn } from "@/lib/vpn-context";

type Kind = "v2ray" | "ssh" | "wireguard" | "openvpn" | "subscription";
type Method = "manual" | "paste" | "file";

const KINDS: { id: Kind; title: string; desc: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "v2ray", title: "V2Ray", desc: "VLESS, VMess, Trojan, Shadowsocks", icon: Globe2 },
  { id: "ssh", title: "SSH", desc: "Username with password or key", icon: KeyRound },
  { id: "wireguard", title: "WireGuard", desc: "Windscribe and other .conf files", icon: Network },
  { id: "openvpn", title: "OpenVPN", desc: "Windscribe and other .ovpn files", icon: ShieldHalf },
  { id: "subscription", title: "Subscription", desc: "A link that provides many configs", icon: Link2 },
];

const METHODS: Record<Kind, Method[]> = {
  v2ray: ["manual", "paste", "file"],
  ssh: ["manual", "paste"],
  wireguard: ["manual", "paste", "file"],
  openvpn: ["manual", "paste", "file"],
  subscription: ["manual"],
};

const METHOD_META: Record<Method, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  manual: { label: "Manual", icon: PencilLine },
  paste: { label: "Paste", icon: ClipboardPaste },
  file: { label: "File", icon: FileUp },
};

const PLACEHOLDER: Record<Kind, string> = {
  v2ray: "vless://…\nvmess://…\ntrojan://…\nss://…\n\nPaste one or many links (and subscription URLs).",
  ssh: "ssh://user:password@host:22#My server\n\nOne link per line.",
  wireguard: "[Interface]\nPrivateKey = …\nAddress = 10.0.0.2/32\n\n[Peer]\nPublicKey = …\nEndpoint = host:51820\nAllowedIPs = 0.0.0.0/0",
  openvpn: "client\ndev tun\nproto udp\nremote host 1194\n<ca>\n-----BEGIN CERTIFICATE-----\n…\n</ca>",
  subscription: "",
};

export function AddConfigDialog() {
  const { addDialogOpen, setAddDialogOpen, reportImport, setView } = useVpn();
  const [kind, setKind] = useState<Kind | null>(null);
  const [method, setMethod] = useState<Method>("manual");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!addDialogOpen) {
      const t = setTimeout(() => setKind(null), 200);
      return () => clearTimeout(t);
    }
  }, [addDialogOpen]);

  const submit = async (fn: () => Promise<ImportResult>) => {
    setBusy(true);
    try {
      const r = await fn();
      reportImport(r);
      if (r.added.length) {
        setAddDialogOpen(false);
        setView("configs");
      }
    } catch (e) {
      toast.error("Could not add config", { description: cleanError(e) });
    } finally {
      setBusy(false);
    }
  };

  const meta = KINDS.find((k) => k.id === kind);

  return (
    <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
      <DialogContent className="max-h-[calc(100vh-2rem)] gap-5 overflow-y-auto rounded-3xl p-6 sm:max-w-xl">
        {!kind || !meta ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-lg">Add config</DialogTitle>
              <DialogDescription>
                Choose the type. Tip: press <Kbd>Ctrl</Kbd> + <Kbd>V</Kbd> anywhere in the app to import from the clipboard.
              </DialogDescription>
            </DialogHeader>
            <div className="grid animate-in gap-2 duration-200 fade-in">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  onClick={() => {
                    setKind(k.id);
                    setMethod(METHODS[k.id][0]);
                  }}
                  className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 text-left transition-all hover:bg-muted/50 active:scale-[0.99]"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                    <k.icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{k.title}</span>
                    <span className="block text-xs text-muted-foreground">{k.desc}</span>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </button>
              ))}
            </div>
          </>
        ) : (
          <div key={kind} className="flex animate-in flex-col gap-5 duration-200 fade-in slide-in-from-right-2">
            <DialogHeader className="flex-row items-center gap-2">
              <button onClick={() => setKind(null)} className="-ml-1 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Back">
                <ArrowLeft className="size-4" />
              </button>
              <div>
                <DialogTitle className="text-lg">{meta.title}</DialogTitle>
                <DialogDescription>{meta.desc}</DialogDescription>
              </div>
            </DialogHeader>

            {METHODS[kind].length > 1 && (
              <div className="grid grid-flow-col gap-1 rounded-xl bg-muted p-1">
                {METHODS[kind].map((m) => {
                  const M = METHOD_META[m];
                  return (
                    <button
                      key={m}
                      onClick={() => setMethod(m)}
                      className={cn(
                        "flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[13px] font-medium text-muted-foreground transition",
                        method === m && "bg-card text-foreground shadow-sm",
                      )}
                    >
                      <M.icon className="size-3.5" /> {M.label}
                    </button>
                  );
                })}
              </div>
            )}

            {method === "paste" && <PasteForm kind={kind} busy={busy} onSubmit={submit} />}
            {method === "file" && <FileForm kind={kind} busy={busy} onSubmit={submit} />}
            {method === "manual" && kind === "v2ray" && <V2RayForm busy={busy} onSubmit={submit} />}
            {method === "manual" && kind === "ssh" && <SshForm busy={busy} onSubmit={submit} />}
            {method === "manual" && kind === "wireguard" && <WireGuardForm busy={busy} onSubmit={submit} />}
            {method === "manual" && kind === "openvpn" && <OpenVpnForm busy={busy} onSubmit={submit} />}
            {method === "manual" && kind === "subscription" && <SubscriptionForm busy={busy} onSubmit={submit} />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

type FormProps = { busy: boolean; onSubmit: (fn: () => Promise<ImportResult>) => Promise<void> };

// ---------------------------------------------------------------- paste / file

function PasteForm({ kind, busy, onSubmit }: FormProps & { kind: Kind }) {
  const [text, setText] = useState("");
  const [creds, setCreds] = useState({ username: "", password: "" });
  const showCreds = kind === "openvpn" || /auth-user-pass/.test(text);
  return (
    <Form onSubmit={() => onSubmit(() => api().importText(text, { username: creds.username || undefined, password: creds.password || undefined }))} busy={busy} disabled={!text.trim()} label="Add">
      <div className="relative">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER[kind]}
          spellCheck={false}
          className="h-48 w-full resize-none rounded-xl border border-border bg-background p-3 font-mono text-xs outline-none placeholder:text-muted-foreground/70 focus:border-foreground/30"
        />
        <button
          type="button"
          onClick={async () => {
            try {
              setText(await navigator.clipboard.readText());
            } catch {
              toast.error("Clipboard is not accessible");
            }
          }}
          className="absolute right-2 bottom-3 inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium hover:bg-muted"
        >
          <ClipboardPaste className="size-3.5" /> Paste
        </button>
      </div>
      {showCreds && <OvpnCreds value={creds} onChange={setCreds} />}
    </Form>
  );
}

function FileForm({ kind, busy, onSubmit }: FormProps & { kind: Kind }) {
  const [creds, setCreds] = useState({ username: "", password: "" });
  const ext = kind === "wireguard" ? ".conf" : kind === "openvpn" ? ".ovpn" : ".txt / .json";
  return (
    <Form
      onSubmit={() => onSubmit(() => api().importFiles({ username: creds.username || undefined, password: creds.password || undefined }))}
      busy={busy}
      label="Choose files…"
    >
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-8 text-center">
        <FileUp className="size-6 text-muted-foreground" />
        <div className="text-sm font-medium">Import {ext} files</div>
        <div className="text-xs text-muted-foreground">You can select several files at once.</div>
      </div>
      {kind === "openvpn" && <OvpnCreds value={creds} onChange={setCreds} />}
    </Form>
  );
}

// ---------------------------------------------------------------- V2Ray manual

type V2Protocol = "vless" | "vmess" | "trojan" | "ss";
type Transport = "tcp" | "ws" | "grpc" | "httpupgrade" | "h2";
type Security = "none" | "tls" | "reality";

const SS_METHODS = ["2022-blake3-aes-128-gcm", "2022-blake3-aes-256-gcm", "2022-blake3-chacha20-poly1305", "aes-128-gcm", "aes-256-gcm", "chacha20-ietf-poly1305"];
const FINGERPRINTS = ["chrome", "firefox", "safari", "edge", "ios", "android", "random"];

function V2RayForm({ busy, onSubmit }: FormProps) {
  const [f, setF] = useState({
    protocol: "vless" as V2Protocol,
    name: "",
    host: "",
    port: "443",
    id: "",
    method: "aes-128-gcm",
    flow: "",
    transport: "tcp" as Transport,
    path: "/",
    hostHeader: "",
    serviceName: "",
    security: "tls" as Security,
    sni: "",
    fp: "chrome",
    alpn: "",
    pbk: "",
    sid: "",
    insecure: false,
  });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const isSS = f.protocol === "ss";
  const valid = f.host && Number(f.port) > 0 && f.id && (f.security !== "reality" || f.pbk);

  const build = (): string => {
    const name = encodeURIComponent(f.name || `${f.host}:${f.port}`);
    if (isSS) {
      const user = btoa(`${f.method}:${f.id}`);
      return `ss://${user}@${f.host}:${f.port}#${name}`;
    }
    if (f.protocol === "vmess") {
      const j = {
        v: "2",
        ps: f.name || `${f.host}:${f.port}`,
        add: f.host,
        port: f.port,
        id: f.id,
        aid: "0",
        scy: "auto",
        net: f.transport,
        type: "none",
        host: f.hostHeader,
        path: f.transport === "grpc" ? f.serviceName : f.path,
        tls: f.security === "none" ? "" : "tls",
        sni: f.sni,
        fp: f.security === "none" ? "" : f.fp,
        alpn: f.alpn,
        allowInsecure: f.insecure ? "1" : "",
      };
      return `vmess://${btoa(unescape(encodeURIComponent(JSON.stringify(j))))}`;
    }
    const q = new URLSearchParams();
    if (f.protocol === "vless") q.set("encryption", "none");
    q.set("type", f.transport);
    q.set("security", f.security);
    if (f.transport === "ws" || f.transport === "httpupgrade" || f.transport === "h2") {
      if (f.path) q.set("path", f.path);
      if (f.hostHeader) q.set("host", f.hostHeader);
    }
    if (f.transport === "grpc" && f.serviceName) q.set("serviceName", f.serviceName);
    if (f.security !== "none") {
      if (f.sni) q.set("sni", f.sni);
      if (f.fp) q.set("fp", f.fp);
      if (f.alpn) q.set("alpn", f.alpn);
      if (f.insecure) q.set("allowInsecure", "1");
    }
    if (f.security === "reality") {
      q.set("pbk", f.pbk);
      if (f.sid) q.set("sid", f.sid);
    }
    if (f.protocol === "vless" && f.flow) q.set("flow", f.flow);
    return `${f.protocol}://${encodeURIComponent(f.id)}@${f.host}:${f.port}?${q.toString()}#${name}`;
  };

  return (
    <Form onSubmit={() => onSubmit(() => api().importText(build()))} busy={busy} disabled={!valid} label="Add config">
      <Segment
        value={f.protocol}
        onChange={(v) => set({ protocol: v as V2Protocol, security: v === "ss" ? "none" : f.security === "none" ? "tls" : f.security })}
        options={[
          ["vless", "VLESS"],
          ["vmess", "VMess"],
          ["trojan", "Trojan"],
          ["ss", "Shadowsocks"],
        ]}
      />
      <Grid>
        <Field label="Name" span={6}>
          <Input value={f.name} onChange={(v) => set({ name: v })} placeholder="My server" />
        </Field>
        <Field label="Address" span={4}>
          <Input value={f.host} onChange={(v) => set({ host: v.trim() })} placeholder="example.com or 1.2.3.4" />
        </Field>
        <Field label="Port" span={2}>
          <Input value={f.port} onChange={(v) => set({ port: v.replace(/\D/g, "") })} />
        </Field>
        <Field label={f.protocol === "trojan" || isSS ? "Password" : "UUID"} span={isSS ? 3 : 6}>
          <Input value={f.id} onChange={(v) => set({ id: v.trim() })} placeholder={f.protocol === "trojan" || isSS ? "password" : "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"} mono />
        </Field>
        {isSS && (
          <Field label="Method" span={3}>
            <Select value={f.method} onChange={(v) => set({ method: v })} options={SS_METHODS.map((m) => [m, m])} />
          </Field>
        )}
      </Grid>

      {!isSS && (
        <>
          <SubTitle>Transport</SubTitle>
          <Segment
            value={f.transport}
            onChange={(v) => set({ transport: v as Transport })}
            options={[
              ["tcp", "TCP"],
              ["ws", "WebSocket"],
              ["grpc", "gRPC"],
              ["httpupgrade", "HTTPUpgrade"],
              ["h2", "HTTP/2"],
            ]}
          />
          {f.transport !== "tcp" && (
            <Grid>
              {f.transport === "grpc" ? (
                <Field label="Service name" span={6}>
                  <Input value={f.serviceName} onChange={(v) => set({ serviceName: v })} placeholder="grpc-service" mono />
                </Field>
              ) : (
                <>
                  <Field label="Path" span={3}>
                    <Input value={f.path} onChange={(v) => set({ path: v })} placeholder="/" mono />
                  </Field>
                  <Field label="Host header" span={3}>
                    <Input value={f.hostHeader} onChange={(v) => set({ hostHeader: v.trim() })} placeholder="optional" />
                  </Field>
                </>
              )}
            </Grid>
          )}

          <SubTitle>Security</SubTitle>
          <Segment
            value={f.security}
            onChange={(v) => set({ security: v as Security })}
            options={[
              ["none", "None"],
              ["tls", "TLS"],
              ...(f.protocol === "vless" ? ([["reality", "Reality"]] as [string, string][]) : []),
            ]}
          />
          {f.security !== "none" && (
            <Grid>
              <Field label="SNI" span={3}>
                <Input value={f.sni} onChange={(v) => set({ sni: v.trim() })} placeholder={f.host || "server name"} />
              </Field>
              <Field label="Fingerprint" span={3}>
                <Select value={f.fp} onChange={(v) => set({ fp: v })} options={FINGERPRINTS.map((x) => [x, x])} />
              </Field>
              {f.security === "reality" ? (
                <>
                  <Field label="Public key" span={4}>
                    <Input value={f.pbk} onChange={(v) => set({ pbk: v.trim() })} mono />
                  </Field>
                  <Field label="Short ID" span={2}>
                    <Input value={f.sid} onChange={(v) => set({ sid: v.trim() })} mono />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="ALPN" span={3}>
                    <Input value={f.alpn} onChange={(v) => set({ alpn: v.trim() })} placeholder="h2,http/1.1" />
                  </Field>
                  <Field label="Certificate" span={3}>
                    <Toggle checked={f.insecure} onChange={(v) => set({ insecure: v })} label="Allow insecure" />
                  </Field>
                </>
              )}
            </Grid>
          )}
          {f.protocol === "vless" && (
            <Grid>
              <Field label="Flow" span={6}>
                <Select
                  value={f.flow}
                  onChange={(v) => set({ flow: v })}
                  options={[
                    ["", "None"],
                    ["xtls-rprx-vision", "xtls-rprx-vision"],
                  ]}
                />
              </Field>
            </Grid>
          )}
        </>
      )}
    </Form>
  );
}

// ---------------------------------------------------------------- SSH manual

function SshForm({ busy, onSubmit }: FormProps) {
  const [f, setF] = useState({ name: "", host: "", port: "22", user: "", auth: "password" as "password" | "key", password: "", key: "" });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const valid = f.host && f.user && (f.auth === "password" ? f.password : f.key);
  return (
    <Form
      onSubmit={() =>
        onSubmit(() =>
          api().addSsh({
            name: f.name.trim(),
            host: f.host.trim(),
            port: Number(f.port) || 22,
            user: f.user.trim(),
            password: f.auth === "password" ? f.password : undefined,
            privateKey: f.auth === "key" ? f.key.trim() : undefined,
          }),
        )
      }
      busy={busy}
      disabled={!valid}
      label="Add config"
    >
      <Grid>
        <Field label="Name" span={6}>
          <Input value={f.name} onChange={(v) => set({ name: v })} placeholder="My SSH server" />
        </Field>
        <Field label="Host" span={4}>
          <Input value={f.host} onChange={(v) => set({ host: v })} placeholder="1.2.3.4 or host.com" />
        </Field>
        <Field label="Port" span={2}>
          <Input value={f.port} onChange={(v) => set({ port: v.replace(/\D/g, "") })} />
        </Field>
        <Field label="Username" span={6}>
          <Input value={f.user} onChange={(v) => set({ user: v })} />
        </Field>
      </Grid>
      <Segment
        value={f.auth}
        onChange={(v) => set({ auth: v as "password" | "key" })}
        options={[
          ["password", "Password"],
          ["key", "Private key"],
        ]}
      />
      {f.auth === "password" ? (
        <Input type="password" value={f.password} onChange={(v) => set({ password: v })} placeholder="Password" />
      ) : (
        <TextArea value={f.key} onChange={(v) => set({ key: v })} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
      )}
    </Form>
  );
}

// ---------------------------------------------------------------- WireGuard manual

function WireGuardForm({ busy, onSubmit }: FormProps) {
  const [f, setF] = useState({ name: "", privateKey: "", address: "10.0.0.2/32", mtu: "1280", publicKey: "", psk: "", endpoint: "", allowed: "0.0.0.0/0, ::/0", keepalive: "25" });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const valid = f.privateKey && f.publicKey && /:\d+$/.test(f.endpoint) && f.address;
  const conf = () =>
    [
      "[Interface]",
      `PrivateKey = ${f.privateKey}`,
      `Address = ${f.address}`,
      f.mtu ? `MTU = ${f.mtu}` : "",
      "",
      "[Peer]",
      `PublicKey = ${f.publicKey}`,
      f.psk ? `PresharedKey = ${f.psk}` : "",
      `Endpoint = ${f.endpoint}`,
      `AllowedIPs = ${f.allowed}`,
      f.keepalive ? `PersistentKeepalive = ${f.keepalive}` : "",
    ]
      .filter((l) => l !== "")
      .join("\n");
  return (
    <Form onSubmit={() => onSubmit(() => api().importText(conf(), { name: f.name || undefined }))} busy={busy} disabled={!valid} label="Add config">
      <Grid>
        <Field label="Name" span={6}>
          <Input value={f.name} onChange={(v) => set({ name: v })} placeholder="Windscribe Frankfurt" />
        </Field>
      </Grid>
      <SubTitle>Interface</SubTitle>
      <Grid>
        <Field label="Private key" span={6}>
          <Input value={f.privateKey} onChange={(v) => set({ privateKey: v.trim() })} mono />
        </Field>
        <Field label="Address" span={4}>
          <Input value={f.address} onChange={(v) => set({ address: v })} mono />
        </Field>
        <Field label="MTU" span={2}>
          <Input value={f.mtu} onChange={(v) => set({ mtu: v.replace(/\D/g, "") })} />
        </Field>
      </Grid>
      <SubTitle>Peer</SubTitle>
      <Grid>
        <Field label="Public key" span={6}>
          <Input value={f.publicKey} onChange={(v) => set({ publicKey: v.trim() })} mono />
        </Field>
        <Field label="Endpoint" span={4}>
          <Input value={f.endpoint} onChange={(v) => set({ endpoint: v.trim() })} placeholder="host:51820" mono />
        </Field>
        <Field label="Keepalive" span={2}>
          <Input value={f.keepalive} onChange={(v) => set({ keepalive: v.replace(/\D/g, "") })} />
        </Field>
        <Field label="Preshared key (optional)" span={6}>
          <Input value={f.psk} onChange={(v) => set({ psk: v.trim() })} mono />
        </Field>
        <Field label="Allowed IPs" span={6}>
          <Input value={f.allowed} onChange={(v) => set({ allowed: v })} mono />
        </Field>
      </Grid>
    </Form>
  );
}

// ---------------------------------------------------------------- OpenVPN manual

function OpenVpnForm({ busy, onSubmit }: FormProps) {
  const [f, setF] = useState({
    name: "",
    host: "",
    port: "1194",
    proto: "udp",
    ca: "",
    tlsKey: "",
    tlsMode: "tls-auth" as "tls-auth" | "tls-crypt",
    cipher: "AES-256-GCM",
    auth: "SHA512",
    username: "",
    password: "",
  });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const valid = f.host && f.port && f.ca.includes("BEGIN CERTIFICATE");
  const ovpn = () =>
    [
      "client",
      "dev tun",
      `proto ${f.proto}`,
      `remote ${f.host} ${f.port}`,
      f.username ? "auth-user-pass" : "",
      `cipher ${f.cipher}`,
      `data-ciphers ${f.cipher}`,
      `auth ${f.auth}`,
      "remote-cert-tls server",
      `<ca>\n${f.ca.trim()}\n</ca>`,
      f.tlsKey && f.tlsMode === "tls-auth" ? `key-direction 1\n<tls-auth>\n${f.tlsKey.trim()}\n</tls-auth>` : "",
      f.tlsKey && f.tlsMode === "tls-crypt" ? `<tls-crypt>\n${f.tlsKey.trim()}\n</tls-crypt>` : "",
    ]
      .filter(Boolean)
      .join("\n");
  return (
    <Form
      onSubmit={() => onSubmit(() => api().importText(ovpn(), { name: f.name || undefined, username: f.username || undefined, password: f.password || undefined }))}
      busy={busy}
      disabled={!valid}
      label="Add config"
    >
      <Grid>
        <Field label="Name" span={6}>
          <Input value={f.name} onChange={(v) => set({ name: v })} placeholder="Windscribe London" />
        </Field>
        <Field label="Server" span={3}>
          <Input value={f.host} onChange={(v) => set({ host: v.trim() })} placeholder="host.com" />
        </Field>
        <Field label="Port" span={1}>
          <Input value={f.port} onChange={(v) => set({ port: v.replace(/\D/g, "") })} />
        </Field>
        <Field label="Protocol" span={2}>
          <Select
            value={f.proto}
            onChange={(v) => set({ proto: v })}
            options={[
              ["udp", "UDP"],
              ["tcp", "TCP"],
            ]}
          />
        </Field>
        <Field label="Cipher" span={3}>
          <Select value={f.cipher} onChange={(v) => set({ cipher: v })} options={["AES-256-GCM", "AES-128-GCM", "CHACHA20-POLY1305", "AES-256-CBC"].map((x) => [x, x])} />
        </Field>
        <Field label="Auth digest" span={3}>
          <Select value={f.auth} onChange={(v) => set({ auth: v })} options={["SHA512", "SHA256", "SHA1"].map((x) => [x, x])} />
        </Field>
        <Field label="CA certificate" span={6}>
          <TextArea value={f.ca} onChange={(v) => set({ ca: v })} placeholder="-----BEGIN CERTIFICATE-----" />
        </Field>
        <Field label="TLS key (optional)" span={6}>
          <div className="flex flex-col gap-2">
            <Segment
              value={f.tlsMode}
              onChange={(v) => set({ tlsMode: v as "tls-auth" | "tls-crypt" })}
              options={[
                ["tls-auth", "tls-auth"],
                ["tls-crypt", "tls-crypt"],
              ]}
            />
            <TextArea value={f.tlsKey} onChange={(v) => set({ tlsKey: v })} placeholder="-----BEGIN OpenVPN Static key V1-----" />
          </div>
        </Field>
      </Grid>
      <OvpnCreds value={{ username: f.username, password: f.password }} onChange={(c) => set(c)} />
    </Form>
  );
}

// ---------------------------------------------------------------- Subscription

function SubscriptionForm({ busy, onSubmit }: FormProps) {
  const [urls, setUrls] = useState("");
  const [name, setName] = useState("");
  const list = urls
    .split(/\s+/)
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u));
  return (
    <Form
      onSubmit={() => onSubmit(() => (list.length === 1 ? api().addSubscription(list[0], name || undefined) : api().importText(list.join("\n"))))}
      busy={busy}
      disabled={!list.length}
      label={list.length > 1 ? `Add ${list.length} subscriptions` : "Add subscription"}
    >
      <Field label="Subscription URL — one or many, one per line">
        <TextArea value={urls} onChange={setUrls} placeholder="https://example.com/sub/…" />
      </Field>
      {list.length <= 1 && (
        <Field label="Name (optional)">
          <Input value={name} onChange={setName} placeholder="My provider" />
        </Field>
      )}
    </Form>
  );
}

// ---------------------------------------------------------------- small building blocks

function Form({ children, onSubmit, busy, disabled, label }: { children: React.ReactNode; onSubmit: () => void; busy: boolean; disabled?: boolean; label: string }) {
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && !disabled) onSubmit();
      }}
    >
      {children}
      <button
        type="submit"
        disabled={busy || disabled}
        className="mt-1 inline-flex h-11 items-center justify-center gap-2 rounded-full bg-foreground text-sm font-medium text-background transition active:scale-[0.99] disabled:opacity-40"
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        {busy ? "Adding…" : label}
      </button>
    </form>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-6 gap-3">{children}</div>;
}

const SPAN: Record<number, string> = { 1: "col-span-6 sm:col-span-1", 2: "col-span-6 sm:col-span-2", 3: "col-span-6 sm:col-span-3", 4: "col-span-6 sm:col-span-4", 6: "col-span-6" };

function Field({ label, span = 6, children }: { label: string; span?: number; children: React.ReactNode }) {
  return (
    <label className={cn("flex flex-col gap-1.5", SPAN[span])}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return <div className="-mb-1 text-xs font-semibold tracking-wide text-foreground uppercase">{children}</div>;
}

const inputCls = "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-foreground/30";

function Input({ value, onChange, placeholder, type = "text", mono }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; mono?: boolean }) {
  return <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false} className={cn(inputCls, mono && "font-mono text-xs")} />;
}

function TextArea({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      className="h-24 w-full resize-none rounded-lg border border-border bg-background p-3 font-mono text-xs outline-none placeholder:text-muted-foreground/70 focus:border-foreground/30"
    />
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputCls, "cursor-pointer pr-8")}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

function Segment({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl bg-muted p-1">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn("flex-1 rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-muted-foreground transition", value === v && "bg-card text-foreground shadow-sm")}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn("flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition", checked ? "border-warning/40 bg-warning/8 text-foreground" : "border-border text-muted-foreground")}
    >
      <span className={cn("flex size-4 items-center justify-center rounded border", checked ? "border-warning bg-warning text-white" : "border-border")}>{checked && "✓"}</span>
      {label}
    </button>
  );
}

function OvpnCreds({ value, onChange }: { value: { username: string; password: string }; onChange: (v: { username: string; password: string }) => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-3">
      <div className="mb-2 text-xs text-muted-foreground">
        OpenVPN login. For Windscribe, use the credentials from its config generator, not your account login.
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input value={value.username} onChange={(v) => onChange({ ...value, username: v })} placeholder="Username" />
        <Input type="password" value={value.password} onChange={(v) => onChange({ ...value, password: v })} placeholder="Password" />
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-border bg-muted px-1 font-mono text-[11px]">{children}</kbd>;
}
