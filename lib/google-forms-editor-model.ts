/**
 * Maps Google Forms REST `Form` / `Item` shapes to an editor model and builds batchUpdate requests.
 * Keeps editing in Placecom while syncing to the mailbox Google account via Forms API.
 */

export type EmailCollectionUi =
  | "EMAIL_COLLECTION_TYPE_UNSPECIFIED"
  | "DO_NOT_COLLECT"
  | "VERIFIED"
  | "RESPONDER_INPUT";

export type EditorBlockKind =
  | "short_text"
  | "paragraph"
  | "multiple_choice"
  | "checkboxes"
  | "dropdown"
  | "linear_scale"
  | "date"
  | "time"
  | "section"
  | "text_block"
  | "unsupported";

export type EditorBlock =
  | {
      key: string;
      itemId?: string;
      questionId?: string;
      kind: Exclude<EditorBlockKind, "section" | "text_block" | "unsupported">;
      title: string;
      description: string;
      required: boolean;
      choiceOptions?: string[];
      shuffle?: boolean;
      scaleLow?: number;
      scaleHigh?: number;
      scaleLowLabel?: string;
      scaleHighLabel?: string;
      dateIncludeYear?: boolean;
      dateIncludeTime?: boolean;
      timeDuration?: boolean;
    }
  | {
      key: string;
      itemId?: string;
      questionId?: string;
      kind: "section";
      title: string;
      description: string;
    }
  | {
      key: string;
      itemId?: string;
      questionId?: string;
      kind: "text_block";
      title: string;
      description: string;
    }
  | {
      key: string;
      itemId?: string;
      questionId?: string;
      kind: "unsupported";
      title: string;
      description: string;
      hint: string;
      /** Original Google Item JSON — required to save without destroying advanced fields. */
      rawItem?: LooseItem;
    };

export type EditorState = {
  title: string;
  description: string;
  isQuiz: boolean;
  emailCollection: EmailCollectionUi;
  blocks: EditorBlock[];
};

type LooseItem = Record<string, unknown>;

function newKey(): string {
  if (typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }
  return `k_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

export function emptyEditorState(title = ""): EditorState {
  return {
    title,
    description: "",
    isQuiz: false,
    emailCollection: "DO_NOT_COLLECT",
    blocks: [],
  };
}

export function googleFormToEditorState(form: Record<string, unknown>): EditorState {
  const info = (form.info || {}) as { title?: string; description?: string };
  const settings = (form.settings || {}) as {
    quizSettings?: { isQuiz?: boolean };
    emailCollectionType?: string;
  };
  const items = (Array.isArray(form.items) ? form.items : []) as LooseItem[];

  let emailCollection = (settings.emailCollectionType || "DO_NOT_COLLECT") as EmailCollectionUi;
  if (
    emailCollection !== "DO_NOT_COLLECT" &&
    emailCollection !== "VERIFIED" &&
    emailCollection !== "RESPONDER_INPUT" &&
    emailCollection !== "EMAIL_COLLECTION_TYPE_UNSPECIFIED"
  ) {
    emailCollection = "DO_NOT_COLLECT";
  }

  const blocks: EditorBlock[] = [];
  for (const item of items) {
    const b = itemToBlock(item);
    if (b) blocks.push(b);
  }

  return {
    title: String(info.title || ""),
    description: String(info.description || ""),
    isQuiz: Boolean(settings.quizSettings?.isQuiz),
    emailCollection,
    blocks,
  };
}

function itemToBlock(item: LooseItem): EditorBlock | null {
  const title = String(item.title ?? "");
  const description = String(item.description ?? "");
  const itemId = typeof item.itemId === "string" ? item.itemId : undefined;
  const key = newKey();

  if (item.pageBreakItem != null) {
    return { kind: "section", key, itemId, title, description };
  }
  if (item.textItem != null) {
    return { kind: "text_block", key, itemId, title, description };
  }
  if (item.imageItem != null || item.videoItem != null || item.questionGroupItem != null) {
    return {
      kind: "unsupported",
      key,
      itemId,
      title,
      description,
      hint: "Image, video, and grid questions are not editable in Placecom yet.",
      rawItem: JSON.parse(JSON.stringify(item)) as LooseItem,
    };
  }

  const qi = item.questionItem as { question?: LooseItem } | undefined;
  const q = qi?.question;
  if (!q) {
    return {
      kind: "unsupported",
      key,
      itemId,
      title,
      description,
      hint: "Unsupported item.",
      rawItem: JSON.parse(JSON.stringify(item)) as LooseItem,
    };
  }

  const required = Boolean(q.required);
  const questionId = typeof q.questionId === "string" ? q.questionId : undefined;

  const tq = q.textQuestion as { paragraph?: boolean } | undefined;
  if (tq) {
    return {
      kind: tq.paragraph ? "paragraph" : "short_text",
      key,
      itemId,
      questionId,
      title,
      description,
      required,
    };
  }

  const cq = q.choiceQuestion as {
    type?: string;
    options?: { value?: string }[];
    shuffle?: boolean;
  } | undefined;
  if (cq?.type) {
    const opts = (cq.options || []).map((o) => String(o.value || "").trim()).filter(Boolean);
    const shuffle = Boolean(cq.shuffle);
    const typ = cq.type;
    if (typ === "RADIO") {
      return {
        kind: "multiple_choice",
        key,
        itemId,
        questionId,
        title,
        description,
        required,
        choiceOptions: opts.length ? opts : ["Option 1", "Option 2"],
        shuffle,
      };
    }
    if (typ === "CHECKBOX") {
      return {
        kind: "checkboxes",
        key,
        itemId,
        questionId,
        title,
        description,
        required,
        choiceOptions: opts.length ? opts : ["Option 1", "Option 2"],
        shuffle,
      };
    }
    if (typ === "DROP_DOWN") {
      return {
        kind: "dropdown",
        key,
        itemId,
        questionId,
        title,
        description,
        required,
        choiceOptions: opts.length ? opts : ["Option 1", "Option 2"],
        shuffle,
      };
    }
    return {
      kind: "unsupported",
      key,
      itemId,
      title,
      description,
      hint: "This choice question type is not editable in Placecom yet.",
      rawItem: JSON.parse(JSON.stringify(item)) as LooseItem,
    };
  }

  const sq = q.scaleQuestion as {
    low?: number;
    high?: number;
    lowLabel?: string;
    highLabel?: string;
  } | undefined;
  if (sq && typeof sq.low === "number" && typeof sq.high === "number") {
    return {
      kind: "linear_scale",
      key,
      itemId,
      questionId,
      title,
      description,
      required,
      scaleLow: sq.low,
      scaleHigh: sq.high,
      scaleLowLabel: String(sq.lowLabel || ""),
      scaleHighLabel: String(sq.highLabel || ""),
    };
  }

  const dq = q.dateQuestion as { includeYear?: boolean; includeTime?: boolean } | undefined;
  if (dq) {
    return {
      kind: "date",
      key,
      itemId,
      questionId,
      title,
      description,
      required,
      dateIncludeYear: dq.includeYear !== false,
      dateIncludeTime: Boolean(dq.includeTime),
    };
  }

  const tm = q.timeQuestion as { duration?: boolean } | undefined;
  if (tm) {
    return {
      kind: "time",
      key,
      itemId,
      questionId,
      title,
      description,
      required,
      timeDuration: Boolean(tm.duration),
    };
  }

  if (q.fileUploadQuestion != null) {
    return {
      kind: "unsupported",
      key,
      itemId,
      title,
      description,
      hint: "File upload cannot be created via API; remove this question here or manage it in Google Forms.",
      rawItem: JSON.parse(JSON.stringify(item)) as LooseItem,
    };
  }

  return {
    kind: "unsupported",
    key,
    itemId,
    title,
    description,
    hint: "Unsupported question type.",
    rawItem: JSON.parse(JSON.stringify(item)) as LooseItem,
  };
}

function choiceOptions(block: EditorBlock): { value: string }[] {
  if (
    block.kind !== "multiple_choice" &&
    block.kind !== "checkboxes" &&
    block.kind !== "dropdown"
  ) {
    return [];
  }
  const raw = block.choiceOptions?.length ? block.choiceOptions : ["Option 1", "Option 2"];
  return raw.map((v) => ({ value: v.trim() || "Option" }));
}

function blockToGoogleItem(block: EditorBlock): LooseItem {
  const title = block.title.trim() || "(Untitled)";
  const description = block.description.trim();

  if (block.kind === "section") {
    return { title, description, pageBreakItem: {} };
  }
  if (block.kind === "text_block") {
    return { title, description, textItem: {} };
  }
  if (block.kind === "unsupported") {
    if (block.rawItem) {
      const clone = JSON.parse(JSON.stringify(block.rawItem)) as LooseItem;
      clone.title = title;
      clone.description = description;
      return clone;
    }
    return { title, description, textItem: {} };
  }

  if (block.kind === "short_text" || block.kind === "paragraph") {
    return {
      title,
      description,
      questionItem: {
        question: {
          required: block.required,
          textQuestion: { paragraph: block.kind === "paragraph" },
        },
      },
    };
  }

  if (
    block.kind === "multiple_choice" ||
    block.kind === "checkboxes" ||
    block.kind === "dropdown"
  ) {
    const typeMap = {
      multiple_choice: "RADIO",
      checkboxes: "CHECKBOX",
      dropdown: "DROP_DOWN",
    } as const;
    return {
      title,
      description,
      questionItem: {
        question: {
          required: block.required,
          choiceQuestion: {
            type: typeMap[block.kind],
            options: choiceOptions(block),
            shuffle: Boolean(block.shuffle),
          },
        },
      },
    };
  }

  if (block.kind === "linear_scale") {
    const low = Number.isFinite(block.scaleLow) ? Math.floor(block.scaleLow as number) : 1;
    const high = Number.isFinite(block.scaleHigh) ? Math.floor(block.scaleHigh as number) : 5;
    return {
      title,
      description,
      questionItem: {
        question: {
          required: block.required,
          scaleQuestion: {
            low,
            high: Math.max(low + 1, high),
            lowLabel: block.scaleLowLabel || "",
            highLabel: block.scaleHighLabel || "",
          },
        },
      },
    };
  }

  if (block.kind === "date") {
    return {
      title,
      description,
      questionItem: {
        question: {
          required: block.required,
          dateQuestion: {
            includeYear: block.dateIncludeYear !== false,
            includeTime: Boolean(block.dateIncludeTime),
          },
        },
      },
    };
  }

  if (block.kind === "time") {
    return {
      title,
      description,
      questionItem: {
        question: {
          required: block.required,
          timeQuestion: { duration: Boolean(block.timeDuration) },
        },
      },
    };
  }

  return { title, description, textItem: {} };
}

function withItemId(item: LooseItem, itemId: string): LooseItem {
  return { ...item, itemId };
}

function stripServerOnlyFields(item: LooseItem): unknown {
  return JSON.parse(
    JSON.stringify(item, (k, v) => {
      if (k === "questionId") return undefined;
      return v;
    })
  );
}

function updateMaskForItem(item: LooseItem): string {
  const fields: string[] = ["title", "description"];
  if (item.questionItem != null) fields.push("questionItem");
  if (item.pageBreakItem != null) fields.push("pageBreakItem");
  if (item.textItem != null) fields.push("textItem");
  if (item.imageItem != null) fields.push("imageItem");
  if (item.videoItem != null) fields.push("videoItem");
  if (item.questionGroupItem != null) fields.push("questionGroupItem");
  return fields.join(",");
}

function itemsShallowEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type BatchBuildResult = {
  requests: Record<string, unknown>[];
  writeControl?: { requiredRevisionId: string };
};

/**
 * Builds batchUpdate requests from the last known form (`prev` from forms.get) and desired editor state.
 */
export function buildBatchUpdateRequests(
  prev: Record<string, unknown>,
  next: EditorState
): BatchBuildResult {
  const requests: Record<string, unknown>[] = [];
  const revisionId = typeof prev.revisionId === "string" ? prev.revisionId : undefined;

  const prevInfo = (prev.info || {}) as { title?: string; description?: string };
  if (
    String(prevInfo.title || "") !== next.title ||
    String(prevInfo.description || "") !== next.description
  ) {
    requests.push({
      updateFormInfo: {
        info: { title: next.title, description: next.description },
        updateMask: "title,description",
      },
    });
  }

  const prevSettings = (prev.settings || {}) as {
    quizSettings?: { isQuiz?: boolean };
    emailCollectionType?: string;
  };
  const prevQuiz = Boolean(prevSettings.quizSettings?.isQuiz);
  const prevEmail = String(prevSettings.emailCollectionType || "DO_NOT_COLLECT");
  const nextEmail =
    next.emailCollection === "EMAIL_COLLECTION_TYPE_UNSPECIFIED"
      ? "DO_NOT_COLLECT"
      : next.emailCollection;

  if (prevQuiz !== next.isQuiz || prevEmail !== nextEmail) {
    requests.push({
      updateSettings: {
        settings: {
          quizSettings: { isQuiz: next.isQuiz },
          emailCollectionType: nextEmail,
        },
        updateMask: "quizSettings.isQuiz,emailCollectionType",
      },
    });
  }

  const prevItems = (Array.isArray(prev.items) ? prev.items : []) as LooseItem[];
  const prevById = new Map<string, LooseItem>();
  for (const it of prevItems) {
    if (typeof it.itemId === "string") prevById.set(it.itemId, it);
  }

  const nextIds = new Set(
    next.blocks.map((b) => b.itemId).filter((id): id is string => Boolean(id))
  );

  for (const it of prevItems) {
    const id = typeof it.itemId === "string" ? it.itemId : "";
    if (id && !nextIds.has(id)) {
      requests.push({ deleteItem: { itemId: id } });
    }
  }

  let idx = 0;
  for (const block of next.blocks) {
    const built = blockToGoogleItem(block);
    if (block.itemId && prevById.has(block.itemId)) {
      const before = stripServerOnlyFields(prevById.get(block.itemId)!);
      const after = stripServerOnlyFields(withItemId(built, block.itemId));
      if (!itemsShallowEqual(before, after)) {
        const fullItem = withItemId(built, block.itemId);
        requests.push({
          updateItem: {
            item: fullItem,
            location: { index: idx },
            updateMask: updateMaskForItem(fullItem),
          },
        });
      }
      idx++;
    } else {
      requests.push({
        createItem: {
          item: built,
          location: { index: idx },
        },
      });
      idx++;
    }
  }

  const writeControl = revisionId ? { requiredRevisionId: revisionId } : undefined;
  return { requests, writeControl };
}

export function defaultChoiceBlock(kind: "multiple_choice" | "checkboxes" | "dropdown"): EditorBlock {
  return {
    key: newKey(),
    kind,
    title: "",
    description: "",
    required: false,
    choiceOptions: ["Option 1", "Option 2"],
    shuffle: false,
  };
}

export function defaultQuestionBlock(
  kind: Exclude<
    EditorBlockKind,
    "section" | "text_block" | "unsupported" | "multiple_choice" | "checkboxes" | "dropdown"
  >
): EditorBlock {
  const key = newKey();
  switch (kind) {
    case "short_text":
      return { key, kind: "short_text", title: "", description: "", required: false };
    case "paragraph":
      return { key, kind: "paragraph", title: "", description: "", required: false };
    case "linear_scale":
      return {
        key,
        kind: "linear_scale",
        title: "",
        description: "",
        required: false,
        scaleLow: 1,
        scaleHigh: 5,
        scaleLowLabel: "",
        scaleHighLabel: "",
      };
    case "date":
      return {
        key,
        kind: "date",
        title: "",
        description: "",
        required: false,
        dateIncludeYear: true,
        dateIncludeTime: false,
      };
    case "time":
      return {
        key,
        kind: "time",
        title: "",
        description: "",
        required: false,
        timeDuration: false,
      };
    default:
      return { key, kind: "short_text", title: "", description: "", required: false };
  }
}

export function newSectionBlock(): EditorBlock {
  return { key: newKey(), kind: "section", title: "", description: "" };
}

export function newTextBlock(): EditorBlock {
  return { key: newKey(), kind: "text_block", title: "", description: "" };
}
