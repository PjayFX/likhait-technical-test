class Expense < ApplicationRecord
  belongs_to :category

  validate :date_cannot_be_in_the_future

  private

  def date_cannot_be_in_the_future
    return if date.blank?

    errors.add(:date, "can't be in the future") if date > Date.current
  end
end
