import { ModulePlaceholder } from '@/components/module-placeholder';
import { navigationItems } from '@/lib/navigation';
export const metadata = { title: 'Workflows' };
export default function WorkflowsPage() { return <ModulePlaceholder item={navigationItems[2]} outcome="Workflow state, governed actions and operator approvals will be introduced in block 6." sequence={6} />; }
