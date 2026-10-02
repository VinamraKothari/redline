"use client";

import { useEffect } from "react";
import Link from "next/link";
import { FolderKanban, LogOut, Settings, ShieldCheck, UserRound } from "lucide-react";
import { Avatar, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { signOut } from "@/lib/auth/client";
import { setMe, useStore } from "@/lib/store";
import { openSettings, SettingsDialogHost } from "@/components/settings/SettingsDialog";

/** Loads the signed-in profile into the store once per page. */
let mePending: Promise<void> | null = null;

/** The signed-in profile, fetched once per page load however many components ask. */
export function useMe() {
  const me = useStore((s) => s.me);
  useEffect(() => {
    if (me) return;
    mePending ??= api
      .me()
      .then(({ user }) => setMe(user))
      .catch(() => {})
      .finally(() => {
        mePending = null;
      });
  }, [me]);
  return me;
}

export function AccountMenu({ size = 26 }: { size?: number }) {
  const me = useMe();
  return (
    <>
      {/* every page with an account menu can open Settings; pages with their own host (Workspace, Projects) take over */}
      <SettingsDialogHost fallback />
      {!me ? (
        <span style={{ width: size, height: size }} className="inline-block rounded-full bg-hover" />
      ) : (
        <Menu>
          <MenuTrigger asChild>
            <button type="button" className="rounded-full outline-none ring-blue focus-visible:ring-2" aria-label="Account">
              <Avatar name={me.name} color={me.color} src={me.avatar_url} size={size} />
            </button>
          </MenuTrigger>
          <MenuContent align="end" sideOffset={6}>
            <MenuLabel>
              <div className="truncate text-[12.5px] font-medium text-ink">{me.name}</div>
              <div className="truncate text-[11px] font-normal text-ink-3">{me.email}</div>
            </MenuLabel>
            <MenuSeparator />
            <MenuItem asChild>
              <Link href="/">
                <FolderKanban size={13} /> Projects
              </Link>
            </MenuItem>
            <MenuItem asChild>
              <Link href="/account">
                <UserRound size={13} /> Account
              </Link>
            </MenuItem>
            <MenuItem onSelect={openSettings}>
              <Settings size={13} /> Settings
            </MenuItem>
            {/* only admins see the way into /admin; the server checks again on every request there */}
            {me.is_admin && (
              <>
                <MenuSeparator />
                <MenuItem asChild>
                  <Link href="/admin">
                    <ShieldCheck size={13} /> Admin
                  </Link>
                </MenuItem>
              </>
            )}
            <MenuSeparator />
            <MenuItem onSelect={() => signOut()}>
              <LogOut size={13} /> Sign out
            </MenuItem>
          </MenuContent>
        </Menu>
      )}
    </>
  );
}
