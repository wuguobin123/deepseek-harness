import { Link } from 'react-router-dom';
import {
  IconBook,
  IconBolt,
  IconChevronRight,
  IconClock,
  IconGear,
  IconPlug,
  IconRobot
} from '../../components/icons';

const RESOURCE_GROUPS = [
  {
    title: '工作依据',
    description: '管理 AI 用来理解业务和生成答案的内容。',
    items: [
      {
        to: '/knowledge',
        label: '知识库',
        description: '政策、SOP、话术与业务文档',
        Icon: IconBook
      },
      {
        to: '/integrations',
        label: '业务系统',
        description: '插件、MCP 与企业数据连接',
        Icon: IconPlug
      }
    ]
  },
  {
    title: '自动运行',
    description: '配置任务如何被触发、执行和追踪。',
    items: [
      {
        to: '/automations',
        label: '自动化任务',
        description: '可持续运行的业务流程',
        Icon: IconRobot
      },
      {
        to: '/triggers',
        label: '触发规则',
        description: '定时、事件与业务条件',
        Icon: IconBolt
      },
      {
        to: '/history',
        label: '执行历史',
        description: '运行结果、追踪信息和验证证据',
        Icon: IconClock
      }
    ]
  },
  {
    title: '平台',
    description: '管理当前设备上的连接和身份。',
    items: [
      {
        to: '/settings',
        label: '设置',
        description: '服务连接、租户和操作人',
        Icon: IconGear
      }
    ]
  }
] as const;

export function ResourcesPage(): JSX.Element {
  return (
    <section className="page resources-page" data-testid="resources-page">
      <header className="page__header">
        <div>
          <h2>资源</h2>
          <p>需要时再进入配置；日常工作从工作台直接推进。</p>
        </div>
      </header>
      <div className="resource-groups">
        {RESOURCE_GROUPS.map((group) => (
          <section key={group.title}>
            <header>
              <h3>{group.title}</h3>
              <p>{group.description}</p>
            </header>
            <ul>
              {group.items.map(({ to, label, description, Icon }) => (
                <li key={to}>
                  <Link to={to}>
                    <Icon size={17} />
                    <span>
                      <strong>{label}</strong>
                      <small>{description}</small>
                    </span>
                    <IconChevronRight size={14} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
