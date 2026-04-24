import { useEffect, useState } from "react";

export function useUnreadState(api, initialUnread = {}) {
  const [unread, setUnread] = useState(initialUnread ?? {});

  useEffect(() => {
    setUnread(initialUnread ?? {});
  }, [initialUnread]);

  useEffect(() => {
    const offUnread = api.on("conversation:unread", ({ unread: nextUnread }) => {
      setUnread(nextUnread ?? {});
    });
    return () => offUnread();
  }, [api]);

  return unread;
}
