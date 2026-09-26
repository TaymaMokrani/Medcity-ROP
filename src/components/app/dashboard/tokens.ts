/**
 * The dashboard's ink, for the parts drawn in SVG.
 *
 * These are the same values the stylesheet holds, repeated here because a
 * `<path>` needs a colour string rather than a class. One accent and three
 * greys: a chart that needs a rainbow to be read is showing too much at once.
 * The clinical colours are not here — anything carrying a state uses the tone
 * classes, so state is decided in one place.
 */
/**
 * One colour per baby, for the charts that draw several at once.
 *
 * Muted enough to sit beside each other on paper, far enough apart to be told
 * apart at the width of a line. It cycles when a ward has more babies than
 * colours, which is why every series is also named in the legend.
 */
export const SERIES_COLOURS = [
    "#40607a",
    "#2f7d75",
    "#a8763e",
    "#8c5d8f",
    "#4a7c59",
    "#a05b6a",
    "#5b7fa6",
    "#7a6c4f",
];

export const CHART = {
    series: "#40607a",
    seriesWash: "rgba(64, 96, 122, 0.09)",
    muted: "#dfe5ea",
    grid: "#eef1f4",
    axis: "#c8d1da",
};
