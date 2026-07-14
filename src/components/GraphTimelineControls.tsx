import { History, Pause, Play, SkipForward } from "lucide-react";
import type { GraphTimelineFrame } from "../graph/graph-timeline";

interface Props {
  frames: GraphTimelineFrame[];
  frame: GraphTimelineFrame;
  frameIndex: number;
  playing: boolean;
  historical: boolean;
  visibleNodeCount: number;
  totalNodeCount: number;
  staticNodeCount: number;
  onSeek: (index: number) => void;
  onTogglePlayback: () => void;
  onReturnToNow: () => void;
}

const dateFormatter = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric" });

export function GraphTimelineControls(props: Props) {
  const dateLabel = props.frame.current ? "현재" : dateFormatter.format(new Date(props.frame.at));
  const changedCount = props.frame.changedNodeIds.size;
  return <section
    data-testid="graph-timeline"
    data-frame-index={props.frameIndex}
    data-frame-count={props.frames.length}
    data-visible-node-count={props.visibleNodeCount}
    data-static-node-count={props.staticNodeCount}
    data-playing={props.playing}
    aria-label="Memory history timeline"
    className="pointer-events-auto absolute bottom-3 left-1/2 z-40 w-[min(720px,calc(100vw-24px))] -translate-x-1/2 rounded-lg bg-zinc-900/95 px-3 py-2.5 text-[10px] text-zinc-400 shadow-2xl shadow-black/30 backdrop-blur-md md:w-[min(680px,calc(100vw-360px))]"
  >
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        aria-label={props.playing ? "타임라인 일시정지" : "타임라인 재생"}
        aria-pressed={props.playing}
        disabled={props.frames.length < 2}
        onClick={props.onTogglePlayback}
        className="grid size-8 shrink-0 place-items-center rounded-md bg-cyan-950 text-cyan-200 hover:bg-cyan-900 focus-visible:bg-cyan-800 focus-visible:outline-none disabled:cursor-default disabled:opacity-35"
      >{props.playing ? <Pause className="size-3.5" /> : <Play className="ml-0.5 size-3.5" />}</button>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5"><History className="size-3 shrink-0 text-cyan-400" /><span className="truncate font-medium text-zinc-200">Memory history</span><span className="hidden truncate text-zinc-600 sm:inline">기록 시점 · 현재 관계/배치로 재구성</span></div>
          <div className="shrink-0 font-mono text-zinc-300">{dateLabel}</div>
        </div>
        <input
          data-testid="graph-timeline-slider"
          type="range"
          min={0}
          max={Math.max(0, props.frames.length - 1)}
          step={1}
          value={props.frameIndex}
          aria-label="메모리 기록 시점"
          aria-valuetext={dateLabel}
          onChange={(event) => props.onSeek(Number(event.target.value))}
          className="block h-3 w-full accent-cyan-500"
        />
        <div className="mt-1 flex items-center justify-between gap-2 text-zinc-600">
          <span>{props.visibleNodeCount}/{props.totalNodeCount} nodes · version 없음 {props.staticNodeCount}개 상시 유지</span>
          <span>{changedCount ? `${changedCount}개 변화` : props.frame.current ? "현재 스냅샷" : "변화 없음"}</span>
        </div>
      </div>
      <button
        type="button"
        aria-label="현재 시점으로 이동"
        disabled={!props.historical && !props.playing}
        onClick={props.onReturnToNow}
        className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-zinc-800 px-2 text-zinc-300 hover:bg-zinc-700 focus-visible:bg-zinc-600 focus-visible:text-white focus-visible:outline-none disabled:cursor-default disabled:opacity-35"
      ><SkipForward className="size-3" /><span className="hidden sm:inline">Now</span></button>
    </div>
  </section>;
}
