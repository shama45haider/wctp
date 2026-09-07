import TeamBoard from "@/components/TeamBoard";

/**
 * The roster page is drawn entirely by TeamBoard, which has to be a client
 * component to read the saved edits and to know whether the person looking is
 * an admin. This file stays a server component for one reason: metadata
 * cannot be exported from a client component.
 */

export const metadata = { title: "Meet The Team — WECAMETOOPARTY" };

export default function Team() {
  return <TeamBoard />;
}
