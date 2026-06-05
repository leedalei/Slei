import { TasksPage } from "../../features/tasks/TasksPageView";

export function TasksRoute(props: Parameters<typeof TasksPage>[0]) {
  return <TasksPage {...props} />;
}
