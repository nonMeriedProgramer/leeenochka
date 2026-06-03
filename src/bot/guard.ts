import type { Context, NextFunction } from 'grammy';

export async function ownerGuard(ctx: Context, next: NextFunction) {
  const ownerId = Number(process.env.OWNER_TELEGRAM_ID);
  if (!ownerId || ctx.from?.id !== ownerId) {
    await ctx.reply('⛔ Цей бот приватний.');
    return;
  }
  return next();
}
