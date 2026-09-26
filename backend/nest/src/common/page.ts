import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { Response } from 'express';

/** The most rows one request can ask for. */
export const MAX_PAGE_SIZE = 200;

/**
 * `?limit=&offset=` on a list route.
 *
 * Both optional. A request without them gets the whole list, exactly as before
 * pagination existed, so the frontend keeps working unchanged. A request with
 * them gets one page, and the header below says how many rows there are in all.
 */
export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export type Page = Pick<PageQueryDto, 'limit' | 'offset'>;

/** The full count, sent beside the page rather than wrapped around it. */
export const TOTAL_COUNT_HEADER = 'X-Total-Count';

export function sendTotal(response: Response, total: number): void {
  response.setHeader(TOTAL_COUNT_HEADER, String(total));
}
