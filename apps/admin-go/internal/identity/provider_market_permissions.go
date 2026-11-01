package identity

func addProviderMarketPermissions(cat *permissionCatalog) {
	cat.Permissions = append(cat.Permissions,
		permission{Code: "admin.provider-market.read", Name: "market.permissionRead", Group: "market.permissionGroup",
			Description: "market.permissionReadDescription"},
		permission{Code: "admin.provider-market.manage", Name: "market.permissionManage", Group: "market.permissionGroup",
			Description: "market.permissionManageDescription"},
		permission{Code: "admin.provider-market.order", Name: "market.permissionOrder", Group: "market.permissionGroup",
			Description: "market.permissionOrderDescription"},
		permission{Code: "admin.provider-market.review", Name: "market.permissionReview", Group: "market.permissionGroup",
			Description: "market.permissionReviewDescription"},
		permission{Code: "admin.provider-market.promote", Name: "market.permissionPromote", Group: "market.permissionGroup",
			Description: "market.permissionPromoteDescription"},
	)
	cat.Dependencies["admin.provider-market.manage"] = []string{"admin.provider-market.read"}
	cat.Dependencies["admin.provider-market.order"] = []string{"admin.provider-market.read"}
	cat.Dependencies["admin.provider-market.review"] = []string{"admin.provider-market.read"}
	cat.Dependencies["admin.provider-market.promote"] = []string{"admin.provider-market.read"}
}
