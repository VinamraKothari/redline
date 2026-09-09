"use client";

import { useState } from "react";
import { Mail, Trash2, UserPlus, X } from "lucide-react";
import { Avatar, Button, Dialog, DialogContent, IconButton, Input } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { ROLE_LABEL, type ProjectInvite, type ProjectMember, type Role } from "@/lib/types";
import { cn } from "@/lib/util";

const ROLES: Role[] = ["view", "edit", "admin"];
const ROLE_HINT: Record<Role, string> = {
  view: "Open reviews, read comments, export",
  edit: "Comment, draw, create and freeze reviews",
  admin: "Everything, plus members and deleting",
};

function RoleSelect({ value, onChange, disabled, ariaLabel }: { value: Role; onChange: (r: Role) => void; disabled?: boolean; ariaLabel: string }) {
  return (
    <select
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value as Role)}
      className={cn(
        "h-8 rounded-md bg-panel px-2 text-[12.5px] text-ink hairline outline-none focus:shadow-[0_0_0_2px_var(--blue)] disabled:opacity-60",
      )}
    >
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABEL[r]}
        </option>
      ))}
    </select>
  );
}

export function MembersDialog({
  open,
  onOpenChange,
  projectId,
  myId,
  myRole,
  members,
  invites,
  onChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  myId: string;
  myRole: Role;
  members: ProjectMember[];
  invites: ProjectInvite[];
  onChange: () => void;
}) {
  const admin = myRole === "admin";
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("edit");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.invite(projectId, email.trim(), role);
      setMsg({
        kind: "ok",
        text: res.member
          ? `${res.member.profile?.name || email} now has ${ROLE_LABEL[role].toLowerCase()} access.`
          : `Invited ${email.trim()} — access is granted the moment they sign in with that Google account.`,
      });
      setEmail("");
      onChange();
    } catch (err) {
      setMsg({ kind: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function run(fn: () => Promise<unknown>) {
    setMsg(null);
    try {
      await fn();
      onChange();
    } catch (err) {
      setMsg({ kind: "err", text: (err as Error).message });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Members" description={admin ? "Invite people by e-mail and choose what they can do." : "People with access to this project."} width={520}>
        {admin && (
          <form onSubmit={invite} className="flex items-center gap-2">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              aria-label="E-mail to invite"
              className="h-9"
            />
            <RoleSelect value={role} onChange={setRole} ariaLabel="Role for the invitee" />
            <Button type="submit" variant="primary" disabled={busy || !email.trim()} className="h-9 shrink-0">
              <UserPlus size={13} /> Invite
            </Button>
          </form>
        )}
        {admin && (
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
            {ROLES.map((r) => (
              <span key={r} className="mr-3 inline-block">
                <span className="font-medium text-ink-2">{ROLE_LABEL[r]}:</span> {ROLE_HINT[r]}
              </span>
            ))}
          </p>
        )}
        {msg && <p className={cn("mt-3 text-[12.5px]", msg.kind === "err" ? "text-red-ink" : "text-green")}>{msg.text}</p>}

        <ul className="mt-4 flex flex-col gap-1">
          {members.map((m) => {
            const p = m.profile;
            const isMe = m.user_id === myId;
            return (
              <li key={m.user_id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-hover">
                <Avatar name={p?.name || "?"} color={p?.color || "#999"} src={p?.avatar_url} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink">
                    {p?.name || m.user_id} {isMe && <span className="text-ink-3">(you)</span>}
                  </div>
                  <div className="truncate text-[11.5px] text-ink-3">{p?.email}</div>
                </div>
                {admin ? (
                  <RoleSelect value={m.role} onChange={(r) => run(() => api.setRole(projectId, m.user_id, r))} ariaLabel={`Role of ${p?.name || m.user_id}`} />
                ) : (
                  <span className="text-[12px] text-ink-3">{ROLE_LABEL[m.role]}</span>
                )}
                {(admin || isMe) && (
                  <IconButton size="sm" aria-label={isMe ? "Leave project" : `Remove ${p?.name || ""}`} onClick={() => run(() => api.removeMember(projectId, m.user_id))}>
                    {isMe ? <X size={14} /> : <Trash2 size={14} />}
                  </IconButton>
                )}
              </li>
            );
          })}
          {invites.map((i) => (
            <li key={i.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-hover">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-hover text-ink-3">
                <Mail size={13} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-ink">{i.email}</div>
                <div className="text-[11.5px] text-ink-3">Invited · joins as {ROLE_LABEL[i.role].toLowerCase()} on first sign-in</div>
              </div>
              {admin && (
                <IconButton size="sm" aria-label={`Cancel invite for ${i.email}`} onClick={() => run(() => api.cancelInvite(projectId, i.id))}>
                  <X size={14} />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
