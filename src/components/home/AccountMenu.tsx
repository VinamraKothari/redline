"use client";

import { useEffect } from "react";
import Link from "next/link";
import { FolderKanban, LogOut } from "lucide-react";
import { Avatar, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { signOut } from "@/lib/auth/client";
import { setMe, useStore } from "@/lib/store";

/** Loads the signed-in profile into the store once per page. */
export function useMe() {
  const me = useStore((s) => s.me);
  useEffect(() => {
    if (me) return;
    api
      .me()
      .then(({ user }) => setMe(user))
      .catch(() => {});
  }, [me]);
  return me;
}

export function AccountMenu({ size = 26 }: { size?: number }) {
  const me = useMe();
  if (!me) return <span style={{ width: size, height: size }} className="inline-block rounded-full bg-hover" />;
  return (
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
        <MenuItem onSelect={() => signOut()}>
          <LogOut size={13} /> Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
