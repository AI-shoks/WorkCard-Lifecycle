import { describe, expect, it } from 'vitest';

import {
  batchStatusLabels,
  emptyWorkCardsCopy,
  formatCardCount,
  formatHours,
  formatProductCount,
  formatReleasePreview,
  formatSetCount,
  gateStatusLabels,
  workCardPurposeLabels,
  workCardStatusLabels,
} from './read-presenters.js';

describe('русское представление read-only данных', () => {
  it('формирует производственный preview с русскими формами числительных', () => {
    expect(formatReleasePreview(112, 3, 250)).toBe('112 изделий → 3 комплекта → 250 карточек');
    expect(formatProductCount(1)).toBe('1 изделие');
    expect(formatSetCount(5)).toBe('5 комплектов');
  });

  it('не выводит технические enum вместо производственных состояний', () => {
    expect(batchStatusLabels.FINAL_ACCEPTED).toBe('Финальная приёмка выполнена');
    expect(gateStatusLabels.FIRST_ARTICLE_PENDING).toBe('Ожидается первая деталь');
    expect(workCardStatusLabels.IN_PROGRESS).toBe('Выполняется');
    expect(workCardPurposeLabels.SERIAL).toBe('Обработка партии');
  });

  it('показывает норму с русским десятичным разделителем', () => {
    expect(formatHours('0.25')).toBe('0,25 ч');
    expect(formatHours('1')).toBe('1,00 ч');
  });

  it('согласует количество карточек с существительным', () => {
    expect(formatCardCount(1)).toBe('1 карточка');
    expect(formatCardCount(2)).toBe('2 карточки');
    expect(formatCardCount(11)).toBe('11 карточек');
    expect(formatCardCount(25)).toBe('25 карточек');
  });

  it('не выдаёт ограниченную выборку исполнителя за пустой комплект', () => {
    expect(emptyWorkCardsCopy('WORKER', false)).toEqual({
      description: 'Для активного исполнителя в этом комплекте нет доступных назначений.',
      title: 'Нет доступных карточек',
    });
    expect(emptyWorkCardsCopy('MASTER', false).title).toBe('Карточек пока нет');
  });
});
