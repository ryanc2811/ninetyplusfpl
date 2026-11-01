import { HeadToHeadView } from "../../../../_views/h2h-view";

export default async function HeadToHeadPage({
  params,
}: {
  params: Promise<{ id: string; entryId: string }>;
}) {
  const { id, entryId } = await params;
  return <HeadToHeadView leagueId={Number(id)} entryId={Number(entryId)} />;
}
