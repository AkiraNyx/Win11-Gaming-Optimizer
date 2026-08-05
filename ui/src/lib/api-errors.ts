export function getMutationErrorMessage(response: Response, fallback: string): string {
  if (response.status === 400) return "请求内容无效，请刷新页面后重试。";
  if (response.status === 409) return "已有系统操作正在进行，请等待完成后重试。";
  if (response.status === 503) return "当前环境不满足系统修改条件，请检查 Windows 版本、管理员权限和运行目录。";
  return fallback;
}
