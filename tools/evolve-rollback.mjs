import { latestProposal, rollbackProposal } from "./evolution-core.mjs";

const requestedId = process.argv[2];
const latest = requestedId ? null : await latestProposal();
const id = requestedId || latest?.id;

if (!id) {
  console.error("No evolution proposal was found.");
  process.exitCode = 1;
} else {
  try {
    const proposal = await rollbackProposal(id);
    console.log(`Rolled back ${proposal.title} (${proposal.id}).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Rollback failed.");
    process.exitCode = 1;
  }
}
