import type { Context, NextFunction } from 'grammy';

export async function ownerGuard(ctx: Context, next: NextFunction) {
  // Канали (напр. "gym table") — бот туди тільки постить (postWorkoutToChannel /
  // eveningPost), ніколи не реагує на те, що там пишуть. channel_post-апдейти не
  // несуть ctx.from (Telegram ховає автора за каналом), тож без цієї гілки будь-
  // яке повідомлення в каналі виглядало б як "чужий" і отримувало публічну
  // відмову прямо туди ж — саме цей баг і був.
  if (ctx.chat?.type === 'channel') return;

  const ownerId = Number(process.env.OWNER_TELEGRAM_ID);
  if (!ownerId || ctx.from?.id !== ownerId) {
    await ctx.reply('⛔ Цей бот приватний.');
    return;
  }
  return next();
}
