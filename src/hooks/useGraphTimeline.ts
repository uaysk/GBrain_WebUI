import { useCallback, useEffect, useMemo, useState } from "react";
import type { GraphTimelineResponse } from "../api/types";
import { createGraphTimelineFrames } from "../graph/graph-timeline";

const PLAYBACK_INTERVAL_MS = 720;

export function useGraphTimeline(timeline: GraphTimelineResponse | null) {
  const frames = useMemo(() => createGraphTimelineFrames(timeline), [timeline]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const lastIndex = Math.max(0, frames.length - 1);
  const frameSetKey = useMemo(() => frames.map((frame) => `${frame.at}:${frame.changedNodeIds.size}`).join("|"), [frames]);

  useEffect(() => {
    setFrameIndex(lastIndex);
    setPlaying(false);
  }, [frameSetKey, lastIndex, timeline?.graphGeneratedAt]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const timer = window.setInterval(() => {
      setFrameIndex((current) => {
        if (current >= lastIndex) {
          setPlaying(false);
          return lastIndex;
        }
        return current + 1;
      });
    }, PLAYBACK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [frames.length, lastIndex, playing]);

  const seek = useCallback((index: number) => {
    setPlaying(false);
    setFrameIndex(Math.max(0, Math.min(lastIndex, Math.round(index))));
  }, [lastIndex]);

  const togglePlayback = useCallback(() => {
    if (frames.length < 2) return;
    setPlaying((current) => {
      if (!current && frameIndex >= lastIndex) setFrameIndex(0);
      return !current;
    });
  }, [frameIndex, frames.length, lastIndex]);

  const returnToNow = useCallback(() => {
    setPlaying(false);
    setFrameIndex(lastIndex);
  }, [lastIndex]);

  const safeIndex = Math.max(0, Math.min(frameIndex, lastIndex));
  return {
    frames,
    frame: frames[safeIndex] ?? null,
    frameIndex: safeIndex,
    lastIndex,
    playing,
    historical: frames.length > 0 && safeIndex < lastIndex,
    seek,
    togglePlayback,
    returnToNow,
  };
}
