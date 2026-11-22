import { processExpired } from "@/server/substitutions/service";
import { cronRoute } from "@/server/ops/jobs";

/** Replacements the customer didn't answer in time follow the customer's choice. Every 5 minutes, "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("substitutions", () => processExpired());
