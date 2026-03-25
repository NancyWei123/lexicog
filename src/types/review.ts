/**
 * Root object aligned with backend ReviewSessions structure
 */
export interface ReviewSessions {
  sessions: Session[];
}

/**
 * Plain text content part
 */
export interface ContentPartText {
  type: 'text';
  /** Visible text content */
  value: string;
}

/**
 * Fill-in-the-blank content part
 */
export interface ContentPartBlank {
  type: 'blank';
  /** Original vocabulary entry */
  targetEntry: string;
  /** Grammatically perfect form */
  perfectMatch: string;
}

/**
 * Message content part: text or blank
 */
export type ContentPart = ContentPartText | ContentPartBlank;

/**
 * Single dialogue message
 */
export interface Message {
  /** Speaker role */
  role: string;

  /** Message content parts */
  contentParts: ContentPart[];
}

/**
 * Single vocabulary learning session
 */
export interface Session {
  /** Session topic */
  topic: string;

  /** Context introduction */
  contextIntro: string;

  /** Dialogue message list */
  messages: Message[];
}
