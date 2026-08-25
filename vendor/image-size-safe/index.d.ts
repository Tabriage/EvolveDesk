export type ImageSizeResult = {
  width: number;
  height: number;
  type?: string;
  images?: Array<{ width: number; height: number; type?: string }>;
};

export declare const types: readonly string[];
export declare function disableTypes(types: string[]): void;
export declare function imageSize(input: Uint8Array): ImageSizeResult;
export default imageSize;
