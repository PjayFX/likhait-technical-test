class Category < ApplicationRecord
  has_many :expenses, dependent: :destroy

  normalizes :name, with: ->(name) { name.strip }

  validates :name, presence: true, uniqueness: { case_sensitive: false }, length: { maximum: 100 }
end
