import { Mcq } from "./Mcq.jsx";
import { VideoMcq } from "./VideoMcq.jsx";
import { AnimationMcq } from "./AnimationMcq.jsx";
import { DragDrop } from "./DragDrop.jsx";
import { Sequence } from "./Sequence.jsx";
import { SplitScreen } from "./SplitScreen.jsx";
import { HotspotVideo } from "./HotspotVideo.jsx";

export const QUESTION_COMPONENTS = {
  mcq: Mcq,
  video_mcq: VideoMcq,
  animation_mcq: AnimationMcq,
  drag_drop: DragDrop,
  sequence: Sequence,
  split_screen: SplitScreen,
  hotspot_video: HotspotVideo
};
