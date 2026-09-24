/**
 * types.ts —— lite-browser 核心类型定义
 */

export interface InteractiveElement {
  id: string; // 例如 "@1", "@2"
  tag: string;
  role: string;
  text: string;
  selector: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapshotResult {
  elements: InteractiveElement[];
  formatted: string;
  title: string;
  url: string;
}

export interface SessionState {
  port: number;
  wsUrl: string;
  targetId: string;
  url: string;
  updatedAt: string;
}

export interface TrajectoryAction {
  type: 'open' | 'click' | 'type' | 'scroll' | 'wait' | 'eval';
  target?: string;
  selector?: string;
  x?: number;
  y?: number;
  text?: string;
  url?: string;
  direction?: 'up' | 'down';
  amount?: number;
  seconds?: number;
  targetDescription?: string;
  timestamp: number;
}

export interface RecipeStep {
  step: number;
  action: 'open' | 'click' | 'type' | 'scroll' | 'wait';
  target?: string;
  x?: number;
  y?: number;
  text?: string;
  defaultText?: string;
  url?: string;
  direction?: 'up' | 'down';
  amount?: number;
  seconds?: number;
  description?: string;
}

export interface Recipe {
  name: string;
  description: string;
  createdAt: string;
  stepCount: number;
  variables: string[];
  steps: RecipeStep[];
}
