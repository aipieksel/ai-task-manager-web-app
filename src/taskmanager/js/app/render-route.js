import { renderQueue } from '../features/queue/queue-view.js';
import { renderTaskDetail } from '../features/task-detail/task-detail-view.js';
import { renderQuestions } from '../features/questions/questions-view.js';
import { renderVerification } from '../features/verification/verification-view.js';
import { renderActivity } from '../features/activity/activity-view.js';
import { renderAgents } from '../features/agents/agent-control-view.js';
import { renderLessons, renderObservations } from '../features/knowledge/knowledge-view.js';
import { renderProjects } from '../features/projects/projects-view.js';
import { renderSettings } from '../features/settings/settings-view.js';

export function renderRoute(route) {
  switch (route.path) {
    case '/task': return renderTaskDetail(route);
    case '/questions': return renderQuestions(route);
    case '/verification': return renderVerification(route);
    case '/activity': return renderActivity(route);
    case '/agents': return renderAgents(route);
    case '/lessons': return renderLessons(route);
    case '/observations': return renderObservations(route);
    case '/projects': return renderProjects(route);
    case '/settings': return renderSettings(route);
    default: return renderQueue(route);
  }
}
