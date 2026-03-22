# Threshold Groups

## Overview

Thresholds define the tier boundaries for ranking Pokemon in a tierlist. Each threshold group is a named set of 8 numeric cutoff values, one per tier (S, A, B, C, D, E, F, Surge). A Pokemon's performance metric (e.g. realtime, level, resets) is compared against these cutoffs to determine which tier it falls into.

Multiple threshold groups can exist for the same metric, allowing different grading scales. For example, a "lenient" group and a "strict" group for realtime could define different time cutoffs for the same tiers.

## Data Model

### Tierlist Type (in `src/store/tierlist.ts`)

Each `Tierlist` object stores thresholds in three parallel structures and one defaults map:

```typescript
type Tierlist = {
    thresholds_first: Partial<Record<MetricKeys, { label: string, data: number[] }[]>>
    thresholds_best:  Partial<Record<MetricKeys, { label: string, data: number[] }[]>>
    thresholds_recent?: Partial<Record<MetricKeys, { label: string, data: number[] }[]>>
    thresholdDefaults?: {
        first?:  Record<string, string>   // metric -> label
        best?:   Record<string, string>
        recent?: Record<string, string>
    }
    // ...other fields
}
```

- **`thresholds_first`** -- Threshold groups used for the "First" view (first playthrough of each Pokemon).
- **`thresholds_best`** -- Threshold groups used for the "Followup" view (best attempt of each Pokemon).
- **`thresholds_recent`** -- Threshold groups used for the "Best" view (most recent attempt). Optional; falls back to `thresholds_best` when absent.
- **`thresholdDefaults`** -- Maps each `(view, metric)` pair to the label of the threshold group that should be selected by default.

Each threshold entry is an object `{ label: string, data: number[] }` where:
- `label` is a user-defined name (e.g. "default", "strict", "lenient")
- `data` is an array of exactly 8 numbers, one per tier index (S=0, A=1, B=2, C=3, D=4, E=5, F=6, Surge=7)

### Supported Metrics

The six metrics that support thresholds are:
- `realtime` -- Real-world time (stored as milliseconds)
- `gametime` -- In-game clock time (stored as milliseconds)
- `level` -- Pokemon level (integer)
- `resets` -- Number of resets (integer)
- `blackouts` -- Number of blackouts (integer)
- `faults` -- Number of faults (integer)

Time metrics (`realtime`, `gametime`) store values in milliseconds internally but display as `H:MM:SS` format.

## How the Three Views Map to the Data

| UI View Label | `activeCategory` value | Threshold source |
|---|---|---|
| First | `'first'` | `thresholds_first` |
| Followup | `'best'` | `thresholds_best` |
| Best | `'recent'` | `thresholds_recent`, falling back to `thresholds_best` if absent |

The `activeThresholdList` computed property in the tierlist store resolves which threshold array to use based on the active category and metric. The `activeThresholdIndex` selects which group within that array is active for display.

## Default Thresholds

### `DEFAULT_THRESHOLDS_JSON` (in `src/store/workspace.ts`)

The raw default values stored in JSON format (time strings for time metrics, plain numbers for numeric metrics):

```
realtime:  1:00:00 / 1:15:00 / 1:30:00 / 1:45:00 / 2:00:00 / 2:30:00 / 3:00:00 / 3:30:00
gametime:  3:30:00 / 4:00:00 / 4:30:00 / 5:00:00 / 5:30:00 / 6:00:00 / 7:00:00 / 8:00:00
level:     60 / 65 / 70 / 75 / 80 / 85 / 90 / 95
resets:    1 / 5 / 10 / 15 / 20 / 30 / 40 / 50
```

All default groups have the label `"default"`.

### `DEFAULT_THRESHOLDS_PARSED`

The same values parsed into their runtime representation (times converted to milliseconds). Used when creating blank tierlists via `blankDefaultTierlistJson()`.

When a new tierlist is created, `DEFAULT_THRESHOLDS_JSON` is assigned to all three threshold stores (`thresholds_first`, `thresholds_best`, `thresholds_recent`).

## Default Threshold Resolution

When the user switches the active view or tierlist, `resolveDefaultThresholdIndex()` in the tierlist store runs:

1. Looks up `thresholdDefaults[viewKey][activeMetric]` to get a label.
2. Searches the active threshold list for a group with that label.
3. Sets `activeThresholdIndex` to the matching index, or `0` if no match is found.

This means the user's preferred threshold group for each view+metric combination is remembered.

## Serialization

### Parsing (`parseTierlist` in `workspace.ts`)

When loading a tierlist from JSON:
- Time metric threshold values are run through `parseTime()` to convert strings like `"1:30:00.00"` to milliseconds.
- Numeric metric threshold values are copied as-is.
- The three threshold sources (`thresholds_first`, `thresholds_best`, `thresholds_recent`) are processed identically.

### Stringifying (`stringifyTierlist` in `workspace.ts`)

When saving a tierlist to JSON:
- Time metric threshold values are formatted using `METRIC[key].formatValue` to convert milliseconds back to time strings.
- Numeric metric threshold values are copied as-is.
- `thresholds_recent` is only included in the output if it exists on the tierlist.

## Using the Threshold Groups Dialog (UI Guide)

The Threshold Groups dialog (`EditThresholdsWindow.vue`) provides a table-based editor for managing threshold groups.

### Layout

- **Top bar**: Metric selector dropdown and "+ New" button.
- **Table header**: Name column, one column per tier (S through Surge), and action buttons.
- **Rows**: One row per threshold group for the selected metric.
- **Hint bar**: Keyboard shortcut reminders.

### Editing Values

1. Click any value cell to enter edit mode.
2. For **time metrics**: Type digits which are entered right-to-left (like a calculator). The display shows `H:MM:SS` format. Press Backspace to remove the last digit. Paste a time value to populate all digits at once.
3. For **numeric metrics**: Type the number directly into the input field.
4. Press **Tab** or **Enter** to save and advance to the next tier column. **Shift+Tab** or **Shift+Enter** to go backward.
5. Press **Escape** to cancel editing.

### Managing Groups

- **Create**: Click "+ New" to add a new threshold group. It is added to all three views (first, best, recent) simultaneously.
- **Delete**: Click the trash icon to delete a group (with confirmation). Removes it from all views.
- **Rename**: Click the group name to enter label editing mode. Press Enter to save, Escape to cancel.

### Assigning Defaults

Each row has three toggle buttons: **First**, **Followup**, and **Best**.
- Clicking one assigns that threshold group as the default for the corresponding view and the currently selected metric.
- The active assignment is highlighted in green.
- Assigning a group also ensures it exists in that view's threshold array (it is added if missing).

### Reordering

Rows are draggable. Drag a row to a new position to reorder. Reordering is applied to all three view arrays simultaneously, keeping them in sync.

## Architecture Notes

- The `EditThresholdsWindow` uses a **version bump pattern** (`version` ref + `bump()`) to force reactivity updates when mutating the tierlist's threshold arrays in-place. Since Vue cannot detect in-place mutations of deeply nested objects, bumping the version counter invalidates the `allSets` computed property.
- The `allSets` computed merges threshold groups from all three views (first, best, recent) into a single deduplicated list keyed by label. This allows the UI to show a unified view of all groups regardless of which views they are assigned to.
- CRUD operations (create, delete, rename, value editing) propagate changes to all three view arrays to keep them in sync.
