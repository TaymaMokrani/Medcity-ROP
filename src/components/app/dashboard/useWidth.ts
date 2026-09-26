import { useState, useEffect, useCallback } from "react";

/**
 * The measured width of an element, for the charts drawn in SVG.
 *
 * A callback ref rather than `useRef`, because a chart that mounts *after* its
 * data arrives would otherwise never be measured: the effect ran once, on a
 * render where the element did not exist yet, found nothing to observe, and
 * never ran again. The width stayed 0 and the chart drew nothing. A callback
 * ref fires when the node appears, so measuring follows the element rather than
 * the first render.
 */
export function useWidth<T extends HTMLElement>() {
    const [node, setNode] = useState<T | null>(null);
    const [width, setWidth] = useState(0);

    const ref = useCallback((el: T | null) => setNode(el), []);

    useEffect(() => {
        if (!node) return;
        // `observe` reports the element's size once on its own, so there is no
        // first measurement to take here.
        const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
        ro.observe(node);
        return () => ro.disconnect();
    }, [node]);

    return [ref, width] as const;
}
