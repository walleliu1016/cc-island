import { motion } from 'framer-motion';

interface BuddyAnimationProps {
  status: 'working' | 'waiting' | 'idle' | 'pending';
  size?: number;
}

// 像素风格小人动画
export function BuddyAnimation({ status, size = 28 }: BuddyAnimationProps) {
  const pixel = size / 7; // 7像素基础单位

  return (
    <motion.div
      className="relative flex items-end justify-center"
      style={{ width: size * 1.5, height: size }}
    >
      {/* 身体整体动画 */}
      <motion.div
        className="relative"
        animate={
          status === 'working'
            ? { y: [0, -2, 0, -2, 0], rotate: [0, -5, 0, 5, 0] }
            : status === 'pending'
            ? { y: [0, -3, 0], rotate: [-10, 10, -10] }
            : status === 'waiting'
            ? { y: [0, -1, 0] }
            : {}
        }
        transition={{ repeat: Infinity, duration: status === 'working' ? 0.4 : 0.8 }}
      >
        {/* 头部 - 像素方块 */}
        <motion.div
          className="relative"
          animate={
            status === 'waiting'
              ? { rotate: [-10, 10, -10] }
              : status === 'pending'
              ? { scale: [1, 1.1, 1] }
              : {}
          }
          transition={{ repeat: Infinity, duration: 0.6 }}
        >
          {/* 头部主体 */}
          <div
            className="bg-yellow-400"
            style={{
              width: pixel * 4,
              height: pixel * 3,
              boxShadow: `${pixel}px 0 0 #f59e0b, ${pixel * 2}px 0 0 #f59e0b, 0 ${pixel}px 0 #fcd34d, ${pixel}px ${pixel}px 0 #fcd34d, ${pixel * 2}px ${pixel}px 0 #fbbf24`
            }}
          />

          {/* 眼睛 */}
          <motion.div
            className="absolute flex gap-1"
            style={{ top: pixel * 0.5, left: pixel * 0.5 }}
            animate={
              status === 'waiting'
                ? { x: [0, pixel, -pixel, 0] }
                : status === 'pending'
                ? { scale: [1, 1.5, 1] }
                : status === 'working'
                ? { y: [0, -pixel * 0.3, 0] }
                : {}
            }
            transition={{ repeat: Infinity, duration: 0.5 }}
          >
            {/* 左眼 */}
            <div
              className="bg-black"
              style={{ width: pixel, height: pixel * (status === 'pending' ? 1.5 : 1) }}
            />
            {/* 右眼 */}
            <div
              className="bg-black"
              style={{ width: pixel, height: pixel * (status === 'pending' ? 1.5 : 1) }}
            />
          </motion.div>

          {/* 嘴巴 */}
          <motion.div
            className="absolute bg-black"
            style={{
              bottom: pixel * 0.3,
              left: pixel * 1.5,
              width: pixel,
              height: status === 'working' ? pixel * 0.5 : status === 'pending' ? pixel * 1.5 : pixel * 0.3,
            }}
            animate={
              status === 'working'
                ? { width: [pixel, pixel * 1.5, pixel] }
                : status === 'waiting'
                ? { borderRadius: ['0%', '50%', '0%'], width: [pixel, pixel * 1.2, pixel] }
                : {}
            }
            transition={{ repeat: Infinity, duration: 0.3 }}
          />
        </motion.div>

        {/* 身体 */}
        <motion.div
          className="relative mt-1"
          animate={
            status === 'working'
              ? { scaleY: [1, 0.9, 1] }
              : status === 'idle'
              ? { scaleY: [1, 0.95, 1] }
              : {}
          }
          transition={{ repeat: Infinity, duration: status === 'idle' ? 2 : 0.5 }}
        >
          {/* 身体主体 */}
          <div
            className="bg-blue-500"
            style={{
              width: pixel * 3,
              height: pixel * 2,
              boxShadow: `${pixel}px 0 0 #3b82f6, 0 ${pixel}px 0 #2563eb, ${pixel}px ${pixel}px 0 #1d4ed8`
            }}
          />

          {/* 手臂 */}
          {/* 左臂 */}
          <motion.div
            className="absolute bg-blue-600"
            style={{
              width: pixel,
              height: pixel * 2,
              left: -pixel,
              top: 0,
              originX: 1,
              originY: 0,
            }}
            animate={
              status === 'working'
                ? { rotate: [0, -60, 0, -60, 0], y: [0, pixel * 0.5, 0] }
                : status === 'pending'
                ? { rotate: [0, -90, -60], x: [-pixel * 0.5, -pixel, -pixel * 0.5] }
                : status === 'waiting'
                ? { rotate: 0, y: -pixel * 1 }
                : { rotate: 0 }
            }
            transition={{ repeat: Infinity, duration: status === 'working' ? 0.3 : 0.6 }}
          />
          {/* 右臂 */}
          <motion.div
            className="absolute bg-blue-600"
            style={{
              width: pixel,
              height: pixel * 2,
              right: -pixel,
              top: 0,
              originX: 0,
              originY: 0,
            }}
            animate={
              status === 'working'
                ? { rotate: [0, 60, 0, 60, 0], y: [0, pixel * 0.5, 0] }
                : status === 'pending'
                ? { rotate: [0, 90, 60], x: [pixel * 0.5, pixel, pixel * 0.5] }
                : status === 'waiting'
                ? { rotate: 0, y: -pixel * 1 }
                : { rotate: 0 }
            }
            transition={{ repeat: Infinity, duration: status === 'working' ? 0.3 : 0.6 }}
          />
        </motion.div>

        {/* 腿部 */}
        <div className="flex gap-1 mt-0">
          {/* 左腿 */}
          <motion.div
            className="bg-gray-700"
            style={{ width: pixel, height: pixel }}
            animate={
              status === 'working'
                ? { y: [0, -pixel, 0] }
                : {}
            }
            transition={{ repeat: Infinity, duration: 0.2 }}
          />
          {/* 右腿 */}
          <motion.div
            className="bg-gray-700"
            style={{ width: pixel, height: pixel }}
            animate={
              status === 'working'
                ? { y: [-pixel, 0, -pixel] }
                : {}
            }
            transition={{ repeat: Infinity, duration: 0.2 }}
          />
        </div>
      </motion.div>

      {/* 工作状态特效 - 键盘 */}
      {status === 'working' && (
        <motion.div
          className="absolute -bottom-1 flex gap-0.5"
          animate={{ y: [0, -pixel * 0.5, 0] }}
          transition={{ repeat: Infinity, duration: 0.3 }}
        >
          <div className="bg-gray-600" style={{ width: pixel * 2, height: pixel * 0.5 }} />
          <div className="bg-gray-500" style={{ width: pixel * 2, height: pixel * 0.5 }} />
          <div className="bg-gray-600" style={{ width: pixel * 2, height: pixel * 0.5 }} />
        </motion.div>
      )}

      {/* 思考状态特效 - 问号 */}
      {status === 'waiting' && (
        <motion.div
          className="absolute -top-4 left-1/2 -translate-x-1/2 text-yellow-400 font-bold"
          style={{ fontSize: pixel * 2 }}
          animate={{ y: [0, -pixel, 0], opacity: [1, 0.5, 1] }}
          transition={{ repeat: Infinity, duration: 1 }}
        >
          ?
        </motion.div>
      )}

      {/* 等待状态特效 - 咖啡杯 */}
      {status === 'idle' && (
        <motion.div
          className="absolute -right-2 top-2"
          animate={{ rotate: [0, 10, 0] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
        >
          <div className="bg-amber-600" style={{ width: pixel * 1.5, height: pixel * 2 }} />
          <div className="bg-amber-500" style={{ width: pixel * 0.5, height: pixel, marginLeft: pixel * 1.5 }} />
        </motion.div>
      )}

      {/* 待处理状态特效 - 感叹号 */}
      {status === 'pending' && (
        <motion.div
          className="absolute -top-4 left-1/2 -translate-x-1/2 text-orange-400 font-bold"
          style={{ fontSize: pixel * 2 }}
          animate={{ scale: [1, 1.3, 1] }}
          transition={{ repeat: Infinity, duration: 0.3 }}
        >
          !
        </motion.div>
      )}
    </motion.div>
  );
}

// 预览组件 - 用于展示所有状态
export function BuddyPreview() {
  const statuses: Array<'working' | 'waiting' | 'idle' | 'pending'> = ['working', 'waiting', 'idle', 'pending'];

  const statusLabels = {
    working: '敲代码',
    waiting: '思考中',
    idle: '喝咖啡',
    pending: '惊讶',
  };

  return (
    <div className="flex gap-4 items-center justify-center p-3 bg-gray-800/50 rounded-lg">
      {statuses.map((status) => (
        <div key={status} className="flex flex-col items-center gap-1">
          <BuddyAnimation status={status} size={32} />
          <span className="text-white/60 text-xs">{statusLabels[status]}</span>
        </div>
      ))}
    </div>
  );
}