/**
 * The old severity-screen parts, now the shared ones.
 *
 * These pieces were built for the severity screen and then copied outward. They
 * live in `components/ui` now, in the app's tokens, so the same band and the
 * same row of numbers appear on the dashboard, on a screening and in the
 * Workspace. This file stays only so the severity components can keep their
 * imports while they are moved over, and `Section` keeps its old name.
 */
export {
    Band as Section,
    Chip,
    Disclosure,
    Eyebrow,
    Measurements,
    Note,
    Panel,
    Stat,
} from "@/components/ui";
