export function renderBasicTimelineBrowse(input: {
  page: number;
  pageSize: number;
  total: number;
}): string {
  return [`Timeline page ${input.page}`, `${input.pageSize} per page`, `Total ${input.total}`].join(
    " ",
  );
}
