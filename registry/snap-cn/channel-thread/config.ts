import {
  type ComponentConfig,
  FONT_FAMILY_CONTROL,
  FPS,
  H,
  W,
} from "@/lib/customizer-config";

/**
 * The default conversation, and the three strings that describe it.
 *
 * They are parallel on purpose: one entry per group in `people`, one avatar per
 * group, and one number per message in `beats` and `opens`. `opens` is the frame
 * the row appears — a group's row shows typing dots until its words land on
 * `beats`, and a later message's row simply waits. Splitting them is what lets a
 * pause be a pause instead of a gap someone has to guess at.
 */
const SCRIPT =
  "Launch video by Thursday?|We have nothing shot.;Already done.|Built it out of snapcn.";

export const channelThreadConfig: ComponentConfig = {
  componentName: "ChannelThread",
  importPath: "@/components/snap-cn/channel-thread",
  controls: {
    script: {
      type: "text",
      default: SCRIPT,
      label: "Script (; group, | line)",
    },
    people: {
      type: "text",
      default: "rhea 9:41 AM;sam 9:42 AM",
      label: "Who, and when",
    },
    beats: {
      type: "text",
      default: "0,12,60,84",
      label: "Message lands (frame)",
    },
    opens: { type: "text", default: "0,12,37,72", label: "Row opens (frame)" },
    avatars: {
      type: "text",
      // The repo ships 24 square photos in `public/avatars`; `follower-rush`
      // draws from the same folder. Faces are the difference between a chat
      // that reads as a chat and one that reads as a wireframe.
      default: "/avatars/07.jpg|/avatars/13.jpg",
      label: "Avatar images (| separated)",
    },
    mode: {
      type: "select",
      // The only scene in the registry that ships dark, and deliberately: a
      // transcript is read against the room it is in, and the reference this was
      // measured from is white type on black. On the warm off-white page the
      // scroll fade — which is the whole depth of the scene — turns the oldest
      // line into a pale smudge that reads as a rendering fault rather than as
      // distance. Light is one prop away and still resolves from the tokens.
      default: "dark",
      options: ["light", "dark"],
      label: "Theme",
    },
    fontFamily: FONT_FAMILY_CONTROL,
  },
  // The last message lands on 84 and the scroll under it is still arriving; 110
  // leaves the finished thread up for most of a second.
  durationInFrames: 110,
  fps: FPS,
  compositionWidth: W,
  compositionHeight: H,
};
